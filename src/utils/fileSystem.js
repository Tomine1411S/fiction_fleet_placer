import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { parseUnitCode, parseShipString, formatShipString } from './parser';

// データ構造の定義（内部利用）
// Pin (Unit): { id, x, y, type: 'fleet'|'label'|'image', fleets: [Fleet], text?, src?, ... }
// Fleet: { id, code, name, ships: [], remarks: "" }
// Ship: { type, classCode, number, name }

export const loadProject = async (file) => {
    const zip = await JSZip.loadAsync(file);
    const data = {
        mapImage: null,
        units: [], // Pins
        images: []
    };

    // マップ画像の読み込み
    const bgFile = zip.file("maps/map_bg.png");
    if (bgFile) {
        const blob = await bgFile.async("blob");
        data.mapImage = URL.createObjectURL(blob);
        data.mapImageBlob = blob;
    }

    // 1. 新しい構造 (fleet/pinN/) の読み込みを試行
    const pinFolders = new Set();
    zip.forEach((relativePath, zipEntry) => {
        const match = relativePath.match(/^fleet\/pin(\d+)\/$/);
        if (match && zipEntry.dir) {
            pinFolders.add(match[1]);
        }
    });

    if (pinFolders.size > 0) {
        // 新形式
        for (const pinIdStr of pinFolders) {
            const pinDir = `fleet/pin${pinIdStr}/`;
            const infoFile = zip.file(`${pinDir}pin_info.txt`);

            let pin = {
                id: parseInt(pinIdStr),
                x: 0,
                y: 0,
                type: 'fleet',
                fleets: [],
                ships: [] // 互換性のため（使用しないがエラー回避）
            };

            // pin_info.txt 解析
            if (infoFile) {
                const content = await infoFile.async("string");
                content.split('\n').forEach(line => {
                    const [key, ...values] = line.split(':');
                    if (!key) return;
                    const val = values.join(':').trim();
                    if (key === 'Pos') {
                        const [px, py] = val.split(',').map(Number);
                        pin.x = isNaN(px) ? 0 : px;
                        pin.y = isNaN(py) ? 0 : py;
                    } else if (key === 'Type') {
                        pin.type = val;
                    } else if (key === 'Points') {
                        pin.points = val.split(';').map(p => {
                            const [px, py] = p.split(',').map(Number);
                            return { x: px, y: py };
                        });
                    } else if (key === 'Arrow') {
                        pin.arrow = val === 'true';
                    } else if (key === 'DisplayName') {
                        pin.displayName = val;
                    } else if (key === 'Text') {
                        pin.text = val;
                    } else if (key === 'FontSize') {
                        pin.fontSize = parseInt(val);
                    } else if (key === 'Color') {
                        pin.color = val;
                    } else if (key === 'Width') {
                        pin.width = parseInt(val);
                    } else if (key === 'Rotation') {
                        pin.rotation = parseInt(val);
                    } else if (key === 'ShapeType') {
                        pin.shapeType = val;
                        pin.type = 'shape'; // Ensure type is shape
                    } else if (key === 'Height') {
                        pin.height = parseInt(val);
                    } else if (key === 'Opacity') {
                        pin.opacity = parseFloat(val);
                    }
                    // Image Src handling is tricky for blob, skip for now or implement if needed
                });
            }

            // Pin内のFleet読み込み
            // fleet/pinN/fleetM/
            const fleetFolders = [];
            zip.forEach((relativePath, zipEntry) => {
                if (relativePath.startsWith(pinDir) && zipEntry.dir) {
                    const match = relativePath.match(new RegExp(`^${pinDir}fleet(\\d+)\/$`));
                    if (match) fleetFolders.push(match[1]);
                }
            });

            for (const fleetIdStr of fleetFolders) {
                const fleetDir = `${pinDir}fleet${fleetIdStr}/`;
                const indexFile = zip.file(`${fleetDir}fleet_index.txt`);

                let fleet = {
                    id: Date.now() + Math.random(), // Unique ID inside
                    code: 'New',
                    name: '',
                    ships: [],
                    remarks: ''
                };

                if (indexFile) {
                    const content = await indexFile.async("string");
                    content.split('\n').forEach(line => {
                        const [key, ...values] = line.split(':');
                        if (key) {
                            const val = values.join(':').trim();
                            if (key === 'Code') fleet.code = val;
                            if (key === 'Name') fleet.name = val;
                            if (key === 'Remarks') fleet.remarks = val;
                        }
                    });
                }

                // Ships
                // fleet/pinN/fleetM/XXX.txt
                const shipFiles = [];
                zip.forEach((relativePath) => {
                    if (relativePath.startsWith(fleetDir) && relativePath.endsWith('.txt') && !relativePath.endsWith('_index.txt')) {
                        shipFiles.push(relativePath);
                    }
                });

                for (const sf of shipFiles) {
                    const content = await zip.file(sf).async("string");
                    const info = {};
                    content.split('\n').forEach(line => {
                        const [key, ...values] = line.split(':');
                        if (key && values) info[key.trim()] = values.join(':').trim();
                    });
                    fleet.ships.push({
                        type: info['Type'] || '',
                        classCode: info['Class'] || '',
                        number: info['No'] || '',
                        name: info['Name'] || ''
                    });
                }
                pin.fleets.push(fleet);
            }
            data.units.push(pin);
        }

    } else {
        // 旧形式 (fleet/fleetN/) のマイグレーション読み込み
        // 座標ごとにグルーピングが必要

        // とりあえずフラットに読み込んでから、最後に座標でマージする
        const tempUnits = [];

        const oldFleetFolders = new Set();
        zip.forEach((relativePath, zipEntry) => {
            const match = relativePath.match(/^fleet\/fleet(\d+)\/$/);
            if (match && zipEntry.dir) {
                oldFleetFolders.add(match[1]);
            }
        });

        for (const fid of oldFleetFolders) {
            // ... (前回のloadProjectロジックとほぼ同じだが、fleets構造に入れる)
            const indexFile = zip.file(`fleet/fleet${fid}/fleet${fid}_index.txt`);
            if (indexFile) {
                const content = await indexFile.async("string");
                const info = {};
                content.split('\n').forEach(line => {
                    const [key, ...values] = line.split(':');
                    if (key) info[key.trim()] = values.join(':').trim();
                });
                const [x, y] = (info['Pos'] || "0,0").split(',').map(Number);

                const fleet = {
                    id: parseInt(fid),
                    code: info['Code'] || '',
                    name: info['Name'] || '',
                    remarks: info['Remarks'] || '',
                    ships: []
                };

                // Ships
                zip.forEach((path) => {
                    if (path.startsWith(`fleet/fleet${fid}/`) && path.endsWith('.txt') && !path.endsWith('_index.txt')) {
                        // ... read ship
                    }
                });

                // ※非同期ループが複雑になるため、簡略化してここでは前回ロジックを流用せず
                // 既存コンポーネントが壊れないよう、単純に「1ピン1艦隊」としてロードする
                // 正式なマイグレーションはピンのマージロジックのみ実装する

                // 再実装: シンプルに読み込む
                const unitFiles = Object.keys(zip.files).filter(f => f.startsWith(`fleet/fleet${fid}/`));
                for (const f of unitFiles) {
                    if (f.endsWith(`.txt`) && !f.endsWith('_index.txt')) {
                        const sContent = await zip.file(f).async("string");
                        const sInfo = {};
                        sContent.split('\n').forEach(line => {
                            const [k, ...v] = line.split(':');
                            if (k) sInfo[k.trim()] = v.join(':').trim();
                        });
                        fleet.ships.push({
                            type: sInfo['Type'] || '',
                            classCode: sInfo['Class'] || '',
                            number: sInfo['No'] || '',
                            name: sInfo['Name'] || ''
                        });
                    }
                }

                tempUnits.push({
                    id: parseInt(fid),
                    x: isNaN(x) ? 0 : x,
                    y: isNaN(y) ? 0 : y,
                    type: 'fleet',
                    fleets: [fleet],
                    ships: [] // 互換性
                });
            }
        }

        // 座標マージ (オプション: ここで同じ座標のものを1つのピンにする)
        // 今回の要件「既存データのマイグレーション」 -> 自動マージ推奨
        const mergedMap = new Map(); // "x,y" -> Pin
        tempUnits.forEach(u => {
            const key = `${u.x},${u.y}`;
            if (mergedMap.has(key)) {
                const existing = mergedMap.get(key);
                existing.fleets.push(...u.fleets);
            } else {
                mergedMap.set(key, u);
            }
        });
        data.units = Array.from(mergedMap.values());
    }

    // 2. Master Data Diffs
    const diffDir = "conf/fleet_diff/";
    const shipTypesFile = zip.file(`${diffDir}ship_types.json`);
    const shipClassesFile = zip.file(`${diffDir}ship_classes.json`);
    const fleetTypesFile = zip.file(`${diffDir}fleet_types.json`);

    data.masterDiffs = {};
    if (shipTypesFile) {
        try { data.masterDiffs.shipTypes = JSON.parse(await shipTypesFile.async("string")); } catch (e) { console.error(e); }
    }
    if (shipClassesFile) {
        try { data.masterDiffs.shipClasses = JSON.parse(await shipClassesFile.async("string")); } catch (e) { console.error(e); }
    }
    if (fleetTypesFile) {
        try { data.masterDiffs.fleetTypes = JSON.parse(await fleetTypesFile.async("string")); } catch (e) { console.error(e); }
    }

    return data;
};

export const saveProject = async (state) => {
    const zip = new JSZip();

    // 1. マップ画像
    if (state.mapImageBlob) {
        zip.file("maps/map_bg.png", state.mapImageBlob);
    }

    // 2. ピン情報
    state.units.forEach((pin, pinIndex) => {
        const pinNum = pinIndex + 1;
        const pinDir = zip.folder(`fleet/pin${pinNum}`);

        // pin_info.txt
        let pinInfo = `Pos:${pin.x},${pin.y}\nType:${pin.type || 'fleet'}`;
        if (pin.displayName) pinInfo += `\nDisplayName:${pin.displayName}`;
        if (pin.text) pinInfo += `\nText:${pin.text}`;
        if (pin.fontSize) pinInfo += `\nFontSize:${pin.fontSize}`;
        if (pin.color) pinInfo += `\nColor:${pin.color}`;
        if (pin.width) pinInfo += `\nWidth:${pin.width}`;
        if (pin.height) pinInfo += `\nHeight:${pin.height}`;
        if (pin.rotation) pinInfo += `\nRotation:${pin.rotation}`;
        if (pin.type === 'shape' && pin.shapeType) pinInfo += `\nShapeType:${pin.shapeType}`;
        if (pin.opacity !== undefined) pinInfo += `\nOpacity:${pin.opacity}`;
        if (pin.points) {
            const pts = pin.points.map(p => `${p.x},${p.y}`).join(';');
            pinInfo += `\nPoints:${pts}`;
        }
        if (pin.arrow !== undefined) pinInfo += `\nArrow:${pin.arrow}`;
        pinDir.file("pin_info.txt", pinInfo);

        if (pin.type === 'fleet' || !pin.type) {
            // Fleets
            (pin.fleets || []).forEach((fleet, fleetIndex) => {
                const fleetNum = fleetIndex + 1;
                const fleetDir = pinDir.folder(`fleet${fleetNum}`);

                // fleet_index.txt
                const fInfo = `Code:${fleet.code}\nName:${fleet.name}\nRemarks:${fleet.remarks}`;
                fleetDir.file(`fleet_index.txt`, fInfo);

                // Ships
                (fleet.ships || []).forEach(ship => {
                    const fileName = `${ship.type}_${ship.classCode}${ship.number}.txt`;
                    const content = `Type:${ship.type}\nClass:${ship.classCode}\nNo:${ship.number}\nName:${ship.name}`;
                    fleetDir.file(fileName, content);
                });

                // Fleet Symbol Image
                if (fleet.symbolImage && fleet.symbolImage.startsWith('data:image/')) {
                    const imgData = fleet.symbolImage.split(',')[1];
                    if (imgData) {
                        zip.file(`image/pin${pinNum}/fleet${fleetNum}.png`, imgData, { base64: true });
                    }
                }
            });

            // ... (existing code) ...
            // 指示には特にないため、新構造のみ出力する。
        }
    });

    // 3. Master Data Diffs
    if (state.masterDiffs) {
        const diffDir = zip.folder("conf/fleet_diff");
        if (state.masterDiffs.shipTypes) {
            diffDir.file("ship_types.json", JSON.stringify(state.masterDiffs.shipTypes, null, 2));
        }
        if (state.masterDiffs.shipClasses) {
            diffDir.file("ship_classes.json", JSON.stringify(state.masterDiffs.shipClasses, null, 2));
        }
        if (state.masterDiffs.fleetTypes) {
            diffDir.file("fleet_types.json", JSON.stringify(state.masterDiffs.fleetTypes, null, 2));
        }
    }

    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, "deployment.zip");
};

// 戦力状況テキスト生成 (新構造対応)
export const generateStatusReport = (units) => {
    return units.map(pin => {
        if (pin.type !== 'fleet' && pin.type) return null;

        const header = `Point: (${pin.x}, ${pin.y})`;
        const fleetTexts = (pin.fleets || []).map(f => {
            const ships = (f.ships || []).map(s => `  - ${formatShipString(s)}`).join('\n');
            return `Unit: ${f.code} (${f.name})\n${ships}`;
        }).join('\n\n');

        return `${header}\n${fleetTexts}`;
    }).filter(Boolean).join("\n\n----------------\n\n");
};