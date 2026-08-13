import fs from 'fs';
import path from 'path';

export function loadSourceRegistry(root) {
  const file = path.join(root, 'research', 'sources.json');
  const registry = JSON.parse(fs.readFileSync(file, 'utf8'));
  return new Map(registry.sources.map(source => [source.id, source]));
}

export function assertSourcesAllowed(sourceIds, registry, purpose = 'rule-mining') {
  for (const id of sourceIds || []) {
    if (id === 'clearframe-manual') continue;
    const source = registry.get(id);
    if (!source) throw new Error(`Unknown source "${id}"`);
    if (source.role === 'evaluation-only' && purpose !== 'evaluation') {
      throw new Error(`Evaluation-only source "${id}" cannot be used for ${purpose}`);
    }
  }
}
