import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { parseUnitCode, parseShipString, formatShipString } from './parser';

// New Project Structure:
// root/
//   layers.json  (Contains metadata and units for all layers)
//   layers/
//     layer{id}/
//       map.png
//   config/
//     (overrides)

export const loadProject = async (file) => {
    const zip = await JSZip.loadAsync(file);
    const data = {
        layers: [],
        overrides: {}
    };

    // 1. Check for New Format (layers.json)
    const layersFile = zip.file("layers.json");
    if (layersFile) {
        try {
            const layersJson = await layersFile.async("string");
            data.layers = JSON.parse(layersJson);

            // Load Map Images for each layer
            for (const layer of data.layers) {
                const imgPath = `layers/layer${layer.id}/map.png`;
                const imgFile = zip.file(imgPath);
                if (imgFile) {
                    const blob = await imgFile.async("blob");
                    layer.mapImage = URL.createObjectURL(blob);
                    layer.mapImageBlob = blob; // Keep blob for saving if not changed
                } else {
                    layer.mapImage = null;
                    layer.mapImageBlob = null;
                }
            }
        } catch (e) {
            console.error("Failed to parse layers.json", e);
            throw new Error("Invalid project file format (layers.json corrupted)");
        }
    } else {
        // 2. Fallback to Legacy Format
        console.log("Legacy format detected. Migrating to Layer 1...");
        const legacyUnits = await loadLegacyUnits(zip);

        // Legacy Map Image
        let mapImage = null;
        let mapImageBlob = null;
        const bgFile = zip.file("maps/map_bg.png");
        if (bgFile) {
            const blob = await bgFile.async("blob");
            mapImage = URL.createObjectURL(blob);
            mapImageBlob = blob;
        }

        data.layers = [{
            id: 1,
            name: "Layer 1",
            visible: true,
            units: legacyUnits,
            mapImage: mapImage,
            mapImageBlob: mapImageBlob
        }];
    }

    // 3. Load Config Overrides
    const configDir = "config/";
    const shipTypesFile = zip.file(`${configDir}ship_types.json`);
    const shipClassesFile = zip.file(`${configDir}ship_classes.json`);
    const fleetTypesFile = zip.file(`${configDir}fleet_types.json`);
    const appSettingsFile = zip.file(`${configDir}app_settings.json`);

    if (shipTypesFile) {
        try { data.overrides.shipTypes = JSON.parse(await shipTypesFile.async("string")); } catch (e) { console.error(e); }
    }
    if (shipClassesFile) {
        try { data.overrides.shipClasses = JSON.parse(await shipClassesFile.async("string")); } catch (e) { console.error(e); }
    }
    if (fleetTypesFile) {
        try { data.overrides.fleetTypes = JSON.parse(await fleetTypesFile.async("string")); } catch (e) { console.error(e); }
    }
    if (appSettingsFile) {
        try { data.overrides.appSettings = JSON.parse(await appSettingsFile.async("string")); } catch (e) { console.error(e); }
    }

    return data;
};

// Helper for Legacy Loading
const loadLegacyUnits = async (zip) => {
    const units = [];

    // Check for 'fleet/pinN/' structure (Intermediate Modern)
    const pinFolders = new Set();
    zip.forEach((relativePath) => {
        const match = relativePath.match(/^fleet\/pin(\d+)\/pin_info\.txt$/);
        if (match) pinFolders.add(match[1]);
    });

    if (pinFolders.size > 0) {
        for (const pinIdStr of pinFolders) {
            const pinDir = `fleet/pin${pinIdStr}/`;
            const infoFile = zip.file(`${pinDir}pin_info.txt`);
            let pin = { id: parseInt(pinIdStr), fleets: [], ships: [] };

            if (infoFile) {
                const content = await infoFile.async("string");
                parsePinInfo(pin, content);
            }

            // Fleets in Pin
            const fleetFolders = [];
            zip.forEach((relativePath) => {
                if (relativePath.startsWith(pinDir)) {
                    const match = relativePath.match(new RegExp(`^${pinDir}fleet(\\d+)\/fleet_index\.txt$`));
                    if (match) fleetFolders.push(match[1]);
                }
            });

            for (const fleetIdStr of fleetFolders) {
                const fleetDir = `${pinDir}fleet${fleetIdStr}/`;
                const indexFile = zip.file(`${fleetDir}fleet_index.txt`);
                let fleet = { id: Date.now() + Math.random(), ships: [] };

                if (indexFile) {
                    const content = await indexFile.async("string");
                    parseFleetIndex(fleet, content);
                }

                // Ships
                const shipFiles = [];
                zip.forEach((relativePath) => {
                    if (relativePath.startsWith(fleetDir) && relativePath.endsWith('.txt') && !relativePath.endsWith('_index.txt')) {
                        shipFiles.push(relativePath);
                    }
                });

                for (const sf of shipFiles) {
                    const content = await zip.file(sf).async("string");
                    const info = parseKeyValue(content);
                    fleet.ships.push({
                        type: info['Type'] || '',
                        classCode: info['Class'] || '',
                        number: info['No'] || '',
                        name: info['Name'] || ''
                    });
                }

                // Symbol Image
                const imgFile = zip.file(`image/pin${pinIdStr}/fleet${fleetIdStr}.png`);
                if (imgFile) {
                    const b64 = await imgFile.async("base64");
                    fleet.symbolImage = `data:image/png;base64,${b64}`;
                }

                pin.fleets.push(fleet);
            }
            units.push(pin);
        }
    } else {
        // Oldest Format (fleet/fleetN/)
        const oldFleetFolders = new Set();
        zip.forEach((relativePath, zipEntry) => {
            const match = relativePath.match(/^fleet\/fleet(\d+)\/$/);
            if (match && zipEntry.dir) oldFleetFolders.add(match[1]);
        });

        const tempUnits = [];
        for (const fid of oldFleetFolders) {
            const indexFile = zip.file(`fleet/fleet${fid}/fleet${fid}_index.txt`);
            let fleet = { id: parseInt(fid), ships: [] };
            let pos = { x: 0, y: 0 };

            if (indexFile) {
                const content = await indexFile.async("string");
                const info = parseKeyValue(content);
                fleet.code = info['Code'] || '';
                fleet.name = info['Name'] || '';
                fleet.remarks = info['Remarks'] || '';
                const [x, y] = (info['Pos'] || "0,0").split(',').map(Number);
                pos = { x: isNaN(x) ? 0 : x, y: isNaN(y) ? 0 : y };
            }

            const unitFiles = Object.keys(zip.files).filter(f => f.startsWith(`fleet/fleet${fid}/`) && f.endsWith('.txt') && !f.endsWith('_index.txt'));
            for (const f of unitFiles) {
                const content = await zip.file(f).async("string");
                const info = parseKeyValue(content);
                fleet.ships.push({
                    type: info['Type'] || '',
                    classCode: info['Class'] || '',
                    number: info['No'] || '',
                    name: info['Name'] || ''
                });
            }

            tempUnits.push({
                id: parseInt(fid),
                x: pos.x,
                y: pos.y,
                type: 'fleet',
                fleets: [fleet],
                ships: []
            });
        }

        // Merge by Position
        const mergedMap = new Map();
        tempUnits.forEach(u => {
            const key = `${u.x},${u.y}`;
            if (mergedMap.has(key)) {
                mergedMap.get(key).fleets.push(...u.fleets);
            } else {
                mergedMap.set(key, u);
            }
        });
        units.push(...Array.from(mergedMap.values()));
    }
    return units;
};

const parseKeyValue = (content) => {
    const info = {};
    content.split('\n').forEach(line => {
        const [k, ...v] = line.split(':');
        if (k) info[k.trim()] = v.join(':').trim();
    });
    return info;
};

const parsePinInfo = (pin, content) => {
    content.split('\n').forEach(line => {
        const [key, ...values] = line.split(':');
        if (!key) return;
        const val = values.join(':').trim();
        if (key === 'Pos') {
            const [px, py] = val.split(',').map(Number);
            pin.x = isNaN(px) ? 0 : px;
            pin.y = isNaN(py) ? 0 : py;
        } else if (key === 'Type') pin.type = val;
        else if (key === 'Points') pin.points = val.split(';').map(p => { const [px, py] = p.split(',').map(Number); return { x: px, y: py }; });
        else if (key === 'Arrow') pin.arrow = val === 'true';
        else if (key === 'DisplayName') pin.displayName = val;
        else if (key === 'Text') pin.text = val;
        else if (key === 'FontSize') pin.fontSize = parseInt(val);
        else if (key === 'Color') pin.color = val;
        else if (key === 'Width') pin.width = parseInt(val);
        else if (key === 'Rotation') pin.rotation = parseInt(val);
        else if (key === 'ShapeType') { pin.shapeType = val; pin.type = 'shape'; }
        else if (key === 'Height') pin.height = parseInt(val);
        else if (key === 'Opacity') pin.opacity = parseFloat(val);
    });
};

const parseFleetIndex = (fleet, content) => {
    content.split('\n').forEach(line => {
        const [key, ...values] = line.split(':');
        if (key) {
            const val = values.join(':').trim();
            if (key === 'Code') fleet.code = val;
            if (key === 'Name') fleet.name = val;
            if (key === 'Remarks') fleet.remarks = val;
        }
    });
};


export const saveProject = async (state) => {
    const zip = new JSZip();

    // Prepare Layers JSON (strip heavy blobs)
    const layersToSave = (state.layers || []).map(l => ({
        ...l,
        mapImage: undefined, // Don't save URL 
        mapImageBlob: undefined // Don't save Blob in JSON
    }));

    zip.file("layers.json", JSON.stringify(layersToSave, null, 2));

    // Save Map Images
    for (const layer of (state.layers || [])) {
        if (layer.mapImageBlob) {
            zip.file(`layers/layer${layer.id}/map.png`, layer.mapImageBlob);
        } else if (layer.mapImage && typeof layer.mapImage === 'string' && !layer.mapImage.startsWith('blob:')) {
            // If it's a data URL or external URL? 
            // Currently we only support blob URLs locally or data URLs.
            // If it's a blob url we can't fetch it here easily unless we have the blob.
            // But existing images might be there.
            // If the user hasn't changed the image, it should be in mapImageBlob if we set it on load.
            // If we failed to set mapImageBlob on load (e.g. created from Data URL?), we might lose it.
            // For now, assume mapImageBlob is the source of truth for saving.
        }
    }

    // Save Overrides
    if (state.overrides) {
        const configDir = zip.folder("config");
        if (state.overrides.shipTypes) configDir.file("ship_types.json", JSON.stringify(state.overrides.shipTypes, null, 2));
        if (state.overrides.shipClasses) configDir.file("ship_classes.json", JSON.stringify(state.overrides.shipClasses, null, 2));
        if (state.overrides.fleetTypes) configDir.file("fleet_types.json", JSON.stringify(state.overrides.fleetTypes, null, 2));
        if (state.overrides.appSettings) configDir.file("app_settings.json", JSON.stringify(state.overrides.appSettings, null, 2));
    }

    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, "deployment_v2.zip");
};

export const generateStatusReport = (layers) => {
    // If passed flat units (legacy call), wrap
    const targetLayers = Array.isArray(layers) && !layers[0]?.units ? [{ name: 'Default', units: layers }] : layers;

    return targetLayers.map(layer => {
        if (!layer.units) return '';
        const validUnits = layer.units.filter(u => u.type === 'fleet' || !u.type);
        if (validUnits.length === 0) return '';

        const layerHeader = `=== ${layer.name} ===`;
        const unitTexts = validUnits.map(pin => {
            const header = `Point: (${pin.x}, ${pin.y})`;
            const fleetTexts = (pin.fleets || []).map(f => {
                const ships = (f.ships || []).map(s => `  - ${formatShipString(s)}`).join('\n');
                return `Unit: ${f.code} (${f.name})\n${ships}`;
            }).join('\n\n');
            return `${header}\n${fleetTexts}`;
        }).join("\n\n---\n\n");
        return `${layerHeader}\n${unitTexts}`;
    }).filter(Boolean).join("\n\n================================\n\n");
};