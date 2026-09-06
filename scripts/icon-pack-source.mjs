const fail = (message) => {
  throw new Error(`[icon-pack] ${message}`);
};

const openedAsset = (assetId) => assetId.replace(/\.svg$/, "_opened.svg");

const addMappings = (target, keys, variant, label) => {
  if (keys === undefined) return;
  if (!Array.isArray(keys) || keys.length === 0) fail(`${label} must be a non-empty array`);
  for (const key of keys) {
    if (typeof key !== "string" || !key || target[key]) fail(`${label} contains an invalid or duplicate key`);
    target[key] = variant;
  }
};

export const compileIconPackSource = (source, packId, version) => {
  if (!source || source.schemaVersion !== 1 || source.id !== packId || source.assets !== undefined) {
    fail(`${packId} source has invalid identity or structure`);
  }
  if (
    !source.defaults ||
    typeof source.defaults.file !== "string" ||
    !source.defaults.file.endsWith(".svg") ||
    typeof source.defaults.folder !== "string" ||
    !source.defaults.folder.endsWith(".svg") ||
    !Array.isArray(source.rules) ||
    source.rules.length === 0
  ) {
    fail(`${packId} source must define SVG defaults and rules`);
  }

  const mappings = {
    fileNames: {},
    fileSuffixes: {},
    folderNames: {},
    folderNamesExpanded: {},
    defaults: {
      file: { dark: source.defaults.file },
      folder: { dark: source.defaults.folder },
      folderExpanded: { dark: openedAsset(source.defaults.folder) },
    },
  };
  for (const [index, rule] of source.rules.entries()) {
    if (!rule || typeof rule.icon !== "string" || !rule.icon.endsWith(".svg"))
      fail(`${packId} rule ${index} has no icon`);
    if (rule.light !== undefined && (typeof rule.light !== "string" || !rule.light.endsWith(".svg"))) {
      fail(`${packId} rule ${index} has an invalid light icon`);
    }
    if (rule.fileNames === undefined && rule.fileSuffixes === undefined && rule.folderNames === undefined) {
      fail(`${packId} rule ${index} has no mappings`);
    }
    const variant = { dark: rule.icon, ...(rule.light ? { light: rule.light } : {}) };
    addMappings(mappings.fileNames, rule.fileNames, variant, `${packId} rule ${index}.fileNames`);
    addMappings(mappings.fileSuffixes, rule.fileSuffixes, variant, `${packId} rule ${index}.fileSuffixes`);
    addMappings(mappings.folderNames, rule.folderNames, variant, `${packId} rule ${index}.folderNames`);
    if (rule.folderNames) {
      const expanded = {
        dark: openedAsset(rule.icon),
        ...(rule.light ? { light: openedAsset(rule.light) } : {}),
      };
      addMappings(mappings.folderNamesExpanded, rule.folderNames, expanded, `${packId} rule ${index}.folderNames`);
    }
  }
  const { defaults: _, rules: __, ...metadata } = source;
  return { ...metadata, version, mappings };
};
