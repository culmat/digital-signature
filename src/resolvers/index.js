import Resolver from '@forge/resolver';

const resolver = new Resolver();

resolver.define('getText', (req) => {
  // Use a circular-safe JSON stringify to log the full request object tree
  // This avoids "[Object]" by serializing nested objects, and replaces circular
  // references with "[Circular]" to prevent errors.
  const seen = new WeakSet();
  console.log(JSON.stringify(req, function (key, value) {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        // Mark circular references to avoid infinite recursion
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  }, 2));

  return 'Hello, world from resolver!';
});

export const handler = resolver.getDefinitions();
