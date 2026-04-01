export function toCamel(o) {
  if (Array.isArray(o)) {
    return o.map(toCamel);
  }

  if (o !== null && o.constructor === Object) {
    const newObj = {};
    Object.keys(o).forEach((key) => {
      const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
      newObj[camelKey] = toCamel(o[key]);
    });
    return newObj;
  }

  return o;
}
