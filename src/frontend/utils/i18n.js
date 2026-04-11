// Simple parameter interpolation for translation strings with {variable} placeholders.
// Forge's t() only supports (key, defaultValue) — it does not interpolate parameters.
export const interpolate = (str, params) => {
  let result = str;
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(`{${key}}`, String(value));
  }
  return result;
};
