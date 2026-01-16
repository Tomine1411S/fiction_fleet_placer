
export const createChildLayer = async (parentLayer, boundary, allFleets, existingLayers = [], placementMode = 'split') => {
    // 1. Generate Cropped Image
    let childMapImage = null;
    let childMapBlob = null;

    if (parentLayer.mapImage) {
        try {
            const result = await generateCroppedMapImage(parentLayer.mapImage, boundary);
            childMapImage = result.url;
            childMapBlob = result.blob;
        } catch (e) {
            console.error("Failed to crop map image", e);
            // Fallback? or just continue with empty map
        }
    }

    // 2. Calculate Child Layer ID (simple random or increment)
    // 2. Calculate Child Layer ID (ParentID.ChildNum)
    // Find existing children
    const myChildren = existingLayers.filter(l => l.parentId === parentLayer.id);
    // Parse IDs to find max suffix? Or just count + 1?
    // "2.2" -> "2" is parent.
    // If we delete "2.1", effectively we might get "2.2" again if we count?
    // User request: "通し番号 (sequential number)"
    // Let's use count + 1 for simplicity, or parse max.
    // robust method:
    let nextSuffix = 1;
    if (myChildren.length > 0) {
        // extract suffix
        const suffixes = myChildren.map(c => {
            const parts = String(c.id).split('.');
            return parts.length > 1 ? parseInt(parts[parts.length - 1], 10) : 0;
        });
        nextSuffix = (Math.max(...suffixes) || 0) + 1;
    }
    const childLayerId = `${parentLayer.id}.${nextSuffix}`;

    // 3. Populate Initial Units
    const childUnits = populateChildFleets(parentLayer.units, boundary, allFleets, placementMode);

    // 4. Construct Layer Object
    const childLayer = {
        id: childLayerId,
        name: `${parentLayer.name} Sub-Layer`,
        visible: true, // Visible by default, but view logic handles isolation
        units: childUnits,
        mapImage: childMapImage,
        mapImageBlob: childMapBlob,
        parentId: parentLayer.id,
        boundary: boundary, // Store boundary to reference logic later
        mapImageScale: 6, // User Request: 600% default scale
        x: 0,
        y: 0
    };

    return childLayer;
};

// --- Helper Functions ---

const generateCroppedMapImage = (imageUrl, boundary) => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            // Determine crop dimensions
            let cropX, cropY, cropW, cropH;

            if (boundary.type === 'circle') {
                const r = boundary.width / 2; // Assuming width is diameter
                cropX = boundary.x - r;
                cropY = boundary.y - r;
                cropW = boundary.width; // diameter
                cropH = boundary.width; // diameter
            } else {
                // rect
                cropX = boundary.x - boundary.width / 2;
                cropY = boundary.y - boundary.height / 2;
                cropW = boundary.width;
                cropH = boundary.height;
            }

            // Set canvas size to crop size
            canvas.width = cropW;
            canvas.height = cropH;

            // Draw
            // source coordinates are cropX, cropY
            // dest coordinates are 0, 0
            ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

            canvas.toBlob(blob => {
                if (!blob) reject(new Error("Canvas to Blob failed"));
                resolve({
                    url: URL.createObjectURL(blob),
                    blob: blob
                });
            });
        };
        img.onerror = reject;
        img.src = imageUrl;
    });
};

const populateChildFleets = (parentUnits, boundary, allFleets, placementMode = 'split') => {
    const newUnits = [];

    parentUnits.forEach(unit => {
        // Only process fleet units
        if (unit.type !== 'fleet' && unit.type !== undefined) return;

        // Check if inside boundary
        if (isPointInBoundary(unit.x, unit.y, boundary)) {
            // Transform Coordinates
            const { x, y } = transformParentToChild(unit.x, unit.y, boundary);

            // Get Fleet IDs
            const fleetIds = unit.fleetIds || [];

            if (placementMode === 'split') {
                // "Split" / Explode Fleets
                // For each fleet in the parent pin, create a separate pin in the child
                fleetIds.forEach(fid => {
                    const fleet = allFleets[fid];
                    if (!fleet) return;

                    newUnits.push({
                        id: Date.now() + Math.random(), // New Unit ID
                        x: x,
                        y: y,
                        type: 'fleet',
                        fleetIds: [fid], // Single fleet per pin initially
                        // Copy other visual props if needed, or default
                    });
                });
            } else {
                // "Grouped" / Keep Structure
                newUnits.push({
                    ...unit,
                    id: Date.now() + Math.random(), // New Unit ID
                    x: x,
                    y: y,
                    _layerId: undefined, // Ensure clean
                    // Keep fleetIds as is
                });
            }
        }
    });

    return newUnits;
};

export const transformParentToChild = (px, py, boundary) => {
    let originX, originY;

    if (boundary.type === 'circle') {
        const r = boundary.width / 2;
        originX = boundary.x - r;
        originY = boundary.y - r;
    } else {
        originX = boundary.x - boundary.width / 2;
        originY = boundary.y - boundary.height / 2;
    }

    return {
        x: px - originX,
        y: py - originY
    };
};

export const transformChildToParent = (cx, cy, boundary) => {
    let originX, originY;

    if (boundary.type === 'circle') {
        const r = boundary.width / 2;
        originX = boundary.x - r;
        originY = boundary.y - r;
    } else {
        originX = boundary.x - boundary.width / 2;
        originY = boundary.y - boundary.height / 2;
    }

    return {
        x: cx + originX,
        y: cy + originY
    };
}

export const isPointInBoundary = (x, y, boundary) => {
    if (boundary.type === 'circle') {
        const dx = x - boundary.x;
        const dy = y - boundary.y;
        const r = boundary.width / 2;
        return (dx * dx + dy * dy) <= (r * r);
    } else {
        // Rect: x/y is center
        const halfW = boundary.width / 2;
        const halfH = boundary.height / 2;
        return (
            x >= boundary.x - halfW &&
            x <= boundary.x + halfW &&
            y >= boundary.y - halfH &&
            y <= boundary.y + halfH
        );
    }
};
