/**
 * Normalizes a page key to lowercase snake_case.
 * e.g. "Subscription/All" -> "subscription_all"
 */
const normalizePageKey = (key) => {
  if (!key) return '';
  return key.toLowerCase().replace(/[\/\s-]+/g, '_');
};

/**
 * Converts database permission columns into a unified internal object.
 * @param {Object} user - User object from DB
 * @returns {Object} Unified permissions object
 */
export const buildUnifiedPermissions = (user) => {
  if (!user) return {};
  if (user.user_name === 'admin' || user.role?.toLowerCase() === 'super_admin') {
    return { '*': '*' };
  }

  const unified = {};

  // 1. Process Flat Permissions (Legacy: checklist, maintenance)
  const rawPageAccess = Array.isArray(user.page_access) ? user.page_access : [];
  let processedPageAccess = rawPageAccess;
  if (typeof processedPageAccess === 'string') {
    try { processedPageAccess = JSON.parse(processedPageAccess); } catch (e) { processedPageAccess = []; }
  }

  processedPageAccess.forEach(perm => {
    if (typeof perm !== 'string') return;
    const parts = perm.split('.');
    if (parts.length === 3) {
      const [module, page, action] = parts;
      if (!unified[module]) unified[module] = {};
      unified[module][normalizePageKey(page)] = action;
    } else if (perm === '*') {
      unified['*'] = '*';
    }
  });

  // 2. Process JSON Permissions (New Modules: documentation, subscription, loan, master)
  let docAccess = user.subscription_access_system || { systems: [], pages: {} };
  if (typeof docAccess === 'string') {
    try { docAccess = JSON.parse(docAccess); } catch (e) { docAccess = { systems: [], pages: {} }; }
  }

  if (docAccess.pages && typeof docAccess.pages === 'object') {
    Object.entries(docAccess.pages).forEach(([rawPage, action]) => {
      const page = normalizePageKey(rawPage);
      let module = 'documentation';
      
      if (page.startsWith('subscription') || page.includes('subscription')) module = 'subscription';
      else if (page.startsWith('loan') || page.includes('loan')) module = 'loan';
      else if (page.startsWith('master') || page.includes('master')) module = 'master';
      else if (page === 'resource_manager') module = 'documentation';
      
      if (!unified[module]) unified[module] = {};
      unified[module][page] = action;
    });
  }

  return unified;
};

/**
 * Splits a unified permission object back into database-compatible columns.
 * @param {Object} unified - Unified permissions object
 * @returns {Object} { system_access, page_access, subscription_access_system }
 */
export const splitUnifiedPermissions = (unified) => {
  const system_access = [];
  const page_access = [];
  const docPages = {};
  const docSystems = new Set();
  const jsonModules = ['documentation', 'subscription', 'loan', 'master'];

  Object.entries(unified).forEach(([module, pages]) => {
    if (module === '*') return;

    if (jsonModules.includes(module)) {
      docSystems.add(module);
      Object.entries(pages).forEach(([page, action]) => {
        docPages[normalizePageKey(page)] = action;
      });
    } else {
      system_access.push(module);
      Object.entries(pages).forEach(([page, action]) => {
        page_access.push(`${module}.${normalizePageKey(page)}.${action}`);
      });
    }
  });

  return {
    system_access,
    page_access,
    subscription_access_system: {
      systems: Array.from(docSystems),
      pages: docPages
    }
  };
};

/**
 * Checks if a user has a specific permission.
 */
export const hasPermission = (unifiedPermissions, module, page, action) => {
  if (!unifiedPermissions) return false;
  if (unifiedPermissions['*'] === '*') return true;

  const modulePerms = unifiedPermissions[module];
  if (!modulePerms) return false;

  const normalizedPage = normalizePageKey(page);
  const currentAction = modulePerms[normalizedPage];
  if (!currentAction) return false;

  if (action === 'view') {
    return currentAction === 'view' || currentAction === 'modify';
  }
  
  if (action === 'modify') {
    return currentAction === 'modify';
  }

  return false;
};
