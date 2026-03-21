import yaml from 'js-yaml';

export function renderYaml(data: unknown): string {
  return yaml.dump(data, { indent: 2, lineWidth: 120 });
}
