/**
 * Domain Guard — restrict which websites LobsterCLI can operate on.
 *
 * Three modes:
 *   - No config: works on all websites (default)
 *   - allowDomains: whitelist — ONLY these sites work
 *   - blockDomains: blacklist — everything EXCEPT these sites works
 *
 * Usage (library):
 *   import { DomainGuard } from 'lobster-cli'
 *   const guard = new DomainGuard({ allowDomains: ['bloomberg.com', 'yahoo.com'] })
 *   guard.check('https://bloomberg.com/markets')  // → ok
 *   guard.check('https://reddit.com')             // → throws
 *
 * Usage (config):
 *   lobster config set domains.allow "bloomberg.com,yahoo.com"
 *   lobster config set domains.blockMessage "This tool only works on finance sites."
 */

export interface DomainGuardConfig {
  /** Whitelist — only these domains are allowed. Empty = allow all. */
  allowDomains?: string[];
  /** Blacklist — these domains are blocked. Ignored if allowDomains is set. */
  blockDomains?: string[];
  /** Custom message shown when a domain is blocked. */
  blockMessage?: string;
  /** Allow subdomains to match (e.g., "yahoo.com" matches "finance.yahoo.com"). Default: true */
  matchSubdomains?: boolean;
}

const DEFAULT_BLOCK_MESSAGE = 'This domain is not allowed by the current configuration.';

export class DomainGuard {
  private allow: string[];
  private block: string[];
  private message: string;
  private matchSubs: boolean;

  constructor(config: DomainGuardConfig = {}) {
    this.allow = (config.allowDomains || []).map(d => d.toLowerCase().replace(/^www\./, ''));
    this.block = (config.blockDomains || []).map(d => d.toLowerCase().replace(/^www\./, ''));
    this.message = config.blockMessage || DEFAULT_BLOCK_MESSAGE;
    this.matchSubs = config.matchSubdomains ?? true;
  }

  /**
   * Check if a URL is allowed. Returns true if allowed, throws if blocked.
   */
  check(url: string): true {
    // No restrictions configured — allow everything
    if (this.allow.length === 0 && this.block.length === 0) return true;

    const domain = this.extractDomain(url);
    if (!domain) return true; // Can't parse = allow (for local files, etc.)

    // Whitelist mode: only allowed domains pass
    if (this.allow.length > 0) {
      if (!this.matches(domain, this.allow)) {
        throw new DomainBlockedError(domain, this.message);
      }
      return true;
    }

    // Blacklist mode: blocked domains fail
    if (this.block.length > 0) {
      if (this.matches(domain, this.block)) {
        throw new DomainBlockedError(domain, this.message);
      }
      return true;
    }

    return true;
  }

  /**
   * Check without throwing — returns { allowed, domain, message }.
   */
  test(url: string): { allowed: boolean; domain: string; message?: string } {
    const domain = this.extractDomain(url);
    if (!domain) return { allowed: true, domain: '' };

    try {
      this.check(url);
      return { allowed: true, domain };
    } catch (err) {
      if (err instanceof DomainBlockedError) {
        return { allowed: false, domain, message: err.message };
      }
      return { allowed: true, domain };
    }
  }

  /**
   * Check if domain matches any pattern in the list.
   */
  private matches(domain: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      if (domain === pattern) return true;
      if (this.matchSubs && domain.endsWith('.' + pattern)) return true;
    }
    return false;
  }

  /**
   * Extract domain from URL, stripping www. prefix.
   */
  private extractDomain(url: string): string {
    try {
      const parsed = new URL(url.startsWith('http') ? url : 'https://' + url);
      return parsed.hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  /**
   * Whether any restrictions are active.
   */
  get isRestricted(): boolean {
    return this.allow.length > 0 || this.block.length > 0;
  }

  /**
   * Get list of allowed domains (empty = all allowed).
   */
  get allowedDomains(): string[] {
    return [...this.allow];
  }

  /**
   * Get list of blocked domains.
   */
  get blockedDomains(): string[] {
    return [...this.block];
  }
}

export class DomainBlockedError extends Error {
  public readonly domain: string;

  constructor(domain: string, message: string) {
    super(message);
    this.name = 'DomainBlockedError';
    this.domain = domain;
  }
}
