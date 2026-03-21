import type { ExecutionRequest } from '../types/router.js';
import type { ExecutionResult } from '../types/agent.js';
import type { OutputFormat } from '../types/router.js';
import { ExecutionLevel } from '../types/router.js';
import { makeRoutingDecision } from './decision.js';
import { directFetch } from '../http/index.js';
import { BrowserManager } from '../browser/manager.js';
import { PuppeteerPage } from '../browser/page-adapter.js';
import { AgentCore } from '../agent/core.js';
import { executePipeline } from '../pipeline/index.js';
import type { LobsterConfig } from '../config/index.js';
import { log } from '../utils/logger.js';
import { runWithTimeout } from '../utils/timeout.js';
import { Strategy } from '../types/adapter.js';

export class SmartRouter {
  private config: LobsterConfig;
  private browserManager: BrowserManager;

  constructor(config: LobsterConfig) {
    this.config = config;
    this.browserManager = new BrowserManager({
      executablePath: config.browser.executablePath || undefined,
      headless: config.browser.headless,
      cdpEndpoint: config.browser.cdpEndpoint || undefined,
    });
  }

  async execute(request: ExecutionRequest): Promise<{ data: unknown; format: OutputFormat }> {
    const decision = makeRoutingDecision(request);
    log.debug(`Routing: Level ${ExecutionLevel[decision.level]} — ${decision.reason}`);

    try {
      switch (decision.level) {
        case ExecutionLevel.HTTP:
          return await this.executeHttp(request);

        case ExecutionLevel.ADAPTER:
          return await this.executeAdapter(request, decision);

        case ExecutionLevel.BROWSER:
        case ExecutionLevel.AGENT:
          return await this.executeAgent(request);
      }
    } catch (err) {
      // Escalation: if current level fails, try next
      if (decision.level < ExecutionLevel.AGENT) {
        log.warn(`Level ${ExecutionLevel[decision.level]} failed, escalating...`);
        return this.execute({
          ...request,
          task: request.task || `Fetch content from ${request.url}`,
        });
      }
      throw err;
    }
  }

  private async executeHttp(request: ExecutionRequest): Promise<{ data: unknown; format: OutputFormat }> {
    if (!request.url) throw new Error('URL required for HTTP execution');
    const result = await directFetch(request.url);
    return { data: result.body, format: request.format || 'json' };
  }

  private async executeAdapter(
    request: ExecutionRequest,
    decision: ReturnType<typeof makeRoutingDecision>
  ): Promise<{ data: unknown; format: OutputFormat }> {
    const adapter = decision.adapter!;
    const args = request.args || {};

    // Apply defaults
    for (const arg of adapter.args) {
      if (args[arg.name] === undefined && arg.default !== undefined) {
        args[arg.name] = arg.default;
      }
    }

    let data: unknown;

    if (adapter.pipeline) {
      // Pipeline execution
      let page = null;
      if (adapter.browser !== false && adapter.strategy !== Strategy.PUBLIC) {
        const rawPage = await this.browserManager.newPage();
        page = new PuppeteerPage(rawPage);
        if (adapter.domain) {
          await page.goto(`https://${adapter.domain}`);
        }
      }

      try {
        data = await executePipeline(adapter.pipeline, page, args);
      } finally {
        if (page) await page.close();
      }
    } else if (adapter.func) {
      // Function execution
      const rawPage = await this.browserManager.newPage();
      const page = new PuppeteerPage(rawPage);

      try {
        if (adapter.domain) {
          await page.goto(`https://${adapter.domain}`);
        }
        data = await runWithTimeout(
          adapter.func(page, args),
          (adapter.timeoutSeconds || this.config.browser.commandTimeout) * 1000,
          `${adapter.site}/${adapter.name}`
        );
      } finally {
        await page.close();
      }
    } else {
      throw new Error(`Adapter ${adapter.site}/${adapter.name} has neither func nor pipeline`);
    }

    return { data, format: request.format || 'table' };
  }

  private async executeAgent(request: ExecutionRequest): Promise<{ data: unknown; format: OutputFormat }> {
    if (!this.config.llm.apiKey) {
      throw new Error('LLM API key required for agent mode. Run: lobster config set llm.apiKey <key>');
    }

    const rawPage = await this.browserManager.newPage();
    const page = new PuppeteerPage(rawPage);

    try {
      if (request.url) {
        await page.goto(request.url);
      }

      const agent = new AgentCore(page, {
        llm: this.config.llm,
        maxSteps: this.config.agent.maxSteps,
        stepDelay: this.config.agent.stepDelay,
      });

      const task = request.task || `Extract content from ${request.url}`;
      const result = await agent.execute(task);

      return { data: result.data, format: request.format || 'json' };
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    await this.browserManager.close();
  }
}
