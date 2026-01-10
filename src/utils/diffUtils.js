/**
 * Calculate the difference between a base array and a current array.
 * @param {Array} base - The original array (from CSV).
 * @param {Array} current - The current modified array.
 * @param {string|Function} idKey - The key property to identify items (or a function returning ID).
 * @returns {Object} { added: [], modified: [], deleted: [] }
 */
export const calculateDiff = (base, current, idKey) => {
    const getId = (item) => (typeof idKey === 'function' ? idKey(item) : item[idKey]);

    const baseMap = new Map((base || []).map(item => [getId(item), item]));
    const currentMap = new Map((current || []).map(item => [getId(item), item]));

    const diff = {
        added: [],
        modified: [],
        deleted: []
    };

    // Find Added and Modified
    (current || []).forEach(item => {
        const id = getId(item);
        if (!baseMap.has(id)) {
            diff.added.push(item);
        } else {
            // Check for modification (deep equality check needed, simpler JSON stringify for now)
            const baseItem = baseMap.get(id);
            if (JSON.stringify(item) !== JSON.stringify(baseItem)) {
                diff.modified.push(item);
            }
        }
    });

    // Find Deleted
    (base || []).forEach(item => {
        const id = getId(item);
        if (!currentMap.has(id)) {
            diff.deleted.push(id);
        }
    });

    return diff;
};

/**
 * Apply a diff to a base array to reproduce the current array.
 * @param {Array} base - The original array.
 * @param {Object} diff - The diff object { added, modified, deleted }.
 * @param {string|Function} idKey - The key property to identify items.
 * @returns {Array} The merging result.
 */
export const applyDiff = (base, diff, idKey) => {
    if (!diff) return [...(base || [])];

    const getId = (item) => (typeof idKey === 'function' ? idKey(item) : item[idKey]);
    const baseMap = new Map((base || []).map(item => [getId(item), item]));

    // 1. Remove Deleted
    (diff.deleted || []).forEach(id => {
        baseMap.delete(id);
    });

    // 2. Apply Modified
    (diff.modified || []).forEach(item => {
        const id = getId(item);
        baseMap.set(id, item);
    });

    // 3. Add Added
    (diff.added || []).forEach(item => {
        const id = getId(item);
        baseMap.set(id, item);
    });

    return Array.from(baseMap.values());
};
