import React, { useMemo } from 'react';
import { saveAs } from 'file-saver';

const ShipListScreen = ({ layers, fleets, setFleets, shipTypes, shipClasses, onSwitchScreen, onSelectUnit, isSpectator }) => {

    // 1. Flatten all ships from units -> fleets -> ships
    // 1. Flatten all ships from all layers -> units -> fleets -> ships
    const allShips = useMemo(() => {
        const list = [];

        // Helper to get fleets
        const resolveFleets = (unit) => {
            if (unit.fleetIds) return unit.fleetIds.map(id => fleets[id]).filter(Boolean);
            return unit.fleets || [];
        };

        (layers || []).forEach(layer => {
            (layer.units || []).forEach(unit => {
                const unitFleets = resolveFleets(unit);

                unitFleets.forEach((fleet, fIdx) => {
                    if (fleet && fleet.ships) {
                        fleet.ships.forEach((ship, sIdx) => {
                            if (ship.type && ship.classCode) {
                                list.push({
                                    ...ship,
                                    fleetCode: fleet.code,
                                    fleetName: fleet.name,
                                    unitId: unit.id,
                                    layerId: layer.id, // Track layer
                                    fleetId: fleet.id, // Track fleet ID if check needed
                                    fleetIndex: fIdx,
                                    shipIndex: sIdx,
                                    // Helper for sorting/grouping
                                    fullClass: `${ship.type}-${ship.classCode}`
                                });
                            }
                        });
                    }
                });
            });
        });
        return list;
    }, [layers, fleets]);

    // 2. Group by Type > Class
    const groupedShips = useMemo(() => {
        const groups = {}; // { "Type-Class": [ships...] }

        allShips.forEach(ship => {
            const key = ship.fullClass;
            if (!groups[key]) groups[key] = [];
            groups[key].push(ship);
        });

        // Sort keys (optional, maybe by Type order then Class order)
        return groups;
    }, [allShips]);

    // 3. Duplicate Logic (within same Class)
    const checkDuplicates = (shipsInClass) => {
        const numberMap = {};
        const nameMap = {};
        const duplicates = new Set(); // Set of ship objects that are duplicates

        shipsInClass.forEach(ship => {
            // Check Number
            if (ship.number) {
                if (numberMap[ship.number]) {
                    duplicates.add(ship);
                    duplicates.add(numberMap[ship.number]);
                } else {
                    numberMap[ship.number] = ship;
                }
            }
            // Check Name
            if (ship.name) {
                if (nameMap[ship.name]) {
                    duplicates.add(ship);
                    duplicates.add(nameMap[ship.name]);
                } else {
                    nameMap[ship.name] = ship;
                }
            }
        });
        return duplicates;
    };

    // 4. Random Numbering Logic
    // 4. Random Numbering Logic
    const handleRandomNumbering = (shipsInClass) => {
        if (!setFleets) return;

        // Separate numbered and unnumbered
        const numberedShips = shipsInClass.filter(s => s.number && s.number.trim() !== "");
        const unnumberedShips = shipsInClass.filter(s => !s.number || s.number.trim() === "");

        if (unnumberedShips.length === 0) return;

        // 1. Determine Range
        const existingNumbers = numberedShips.map(s => parseInt(s.number)).filter(n => !isNaN(n));
        const maxExisting = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0;
        const needed = unnumberedShips.length;

        let maxLimit;
        if (needed === 1) {
            maxLimit = maxExisting + 1;
        } else {
            const buffer = Math.ceil(needed * 0.3);
            maxLimit = maxExisting + needed + buffer;
        }

        // 2. Create Candidate List
        const candidates = [];
        const existingSet = new Set(existingNumbers);
        for (let i = 1; i <= maxLimit; i++) {
            if (!existingSet.has(i)) {
                candidates.push(i);
            }
        }

        // 3. Sort Unnumbered Ships (unitId -> fleetIndex -> shipIndex)
        unnumberedShips.sort((a, b) => {
            if (a.unitId !== b.unitId) return a.unitId - b.unitId;
            if (a.fleetIndex !== b.fleetIndex) return a.fleetIndex - b.fleetIndex;
            return a.shipIndex - b.shipIndex;
        });

        // 4. Assign Random Numbers
        // We will modify fleets directly via setFleets
        const newFleets = { ...fleets };
        let hasChanges = false;

        unnumberedShips.forEach(target => {
            if (candidates.length === 0) return;

            // Find target fleet by ID (preferred) or lookup
            // shipsInClass items have 'fleetId' if we added it in step 1.
            // Let's ensure we used fleetId in allShips or fallback

            // If we have fleetId in target (added in step 1 replacement)
            const targetFleetId = target.fleetId;

            if (targetFleetId && newFleets[targetFleetId]) {
                const randIdx = Math.floor(Math.random() * candidates.length);
                const assignedNum = candidates[randIdx];
                candidates.splice(randIdx, 1);

                // Clone fleet and ships
                const fleet = { ...newFleets[targetFleetId] };
                const ships = [...(fleet.ships || [])];

                if (ships[target.shipIndex]) {
                    ships[target.shipIndex] = { ...ships[target.shipIndex], number: assignedNum.toString() };
                    fleet.ships = ships;
                    newFleets[targetFleetId] = fleet;
                    hasChanges = true;
                }
            }
        });

        if (hasChanges) setFleets(newFleets);
    };


    // 5. CSV Download
    const handleDownloadCSV = () => {
        let csv = "Type,Class,Number,Name,FleetCode,FleetName,DuplicateWarning\n";

        Object.keys(groupedShips).sort().forEach(key => {
            const ships = groupedShips[key];
            const duplicates = checkDuplicates(ships);

            // Sort ships by number
            ships.sort((a, b) => (parseInt(a.number) || 0) - (parseInt(b.number) || 0));

            ships.forEach(ship => {
                const isDup = duplicates.has(ship);
                const line = [
                    ship.type,
                    ship.classCode,
                    ship.number,
                    ship.name,
                    ship.fleetCode,
                    ship.fleetName,
                    isDup ? "DUPLICATE" : ""
                ].map(v => `"${v || ''}"`).join(",");
                csv += line + "\n";
            });
        });

        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        saveAs(blob, "ship_list.csv");
    };

    return (
        <div className="screen ship-list-screen" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div className="toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', flexShrink: 0, background: 'white', zIndex: 10 }}>
                <button className="btn" onClick={onSwitchScreen}>＜ マップ画面へ戻る</button>
                <h2>艦艇一覧 (重複チェック)</h2>
                <button className="btn" onClick={handleDownloadCSV}>📥 CSVダウンロード</button>
            </div>

            <div className="list-content" style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', padding: '20px', display: 'flex', alignItems: 'flex-start' }}>
                {Object.keys(groupedShips).sort().map(key => {
                    const ships = groupedShips[key];
                    const duplicates = checkDuplicates(ships);

                    // Display header info check
                    const [tCode, cCode] = key.split('-');
                    const typeName = shipTypes.find(t => t.ship_type_index === tCode)?.name_of_type || tCode;
                    const className = shipClasses.find(c => c.ship_class_index === cCode && c.ship_type_index === tCode)?.ship_class_name || cCode;

                    // Unnumbered count
                    const unnumberedCount = ships.filter(s => !s.number || s.number.trim() === "").length;

                    // Sort ships by number
                    const sortedShips = [...ships].sort((a, b) => (parseInt(a.number) || 0) - (parseInt(b.number) || 0));

                    return (
                        <div key={key} style={{ width: '300px', maxHeight: '100%', marginRight: '20px', border: '1px solid #ccc', borderRadius: '8px', background: 'white', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
                            <div style={{ padding: '16px', borderBottom: '1px solid #eee', background: '#fafafa', borderRadius: '8px 8px 0 0', flexShrink: 0 }}>
                                <h3 style={{ margin: 0, fontSize: '1.1em', display: 'flex', flexWrap: 'wrap', columnGap: '6px' }}>
                                    <span>{typeName}</span>
                                    <span>- {className}</span>
                                </h3>
                                <div style={{ fontSize: '0.9em', color: '#666', marginTop: '4px' }}>Code: {cCode} / {ships.length}隻</div>

                                {!isSpectator && (
                                    <button
                                        className="btn-small"
                                        style={{ marginTop: '8px', width: '100%', padding: '4px', fontSize: '0.9em', cursor: unnumberedCount === 0 ? 'not-allowed' : 'pointer', opacity: unnumberedCount === 0 ? 0.6 : 1 }}
                                        onClick={() => handleRandomNumbering(ships)}
                                        disabled={unnumberedCount === 0}
                                    >
                                        ランダム付番 ({unnumberedCount}隻)
                                    </button>
                                )}
                            </div>

                            <div style={{ overflowY: 'auto', flex: 1, padding: '0 10px 10px' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                    <thead style={{ position: 'sticky', top: 0, background: 'white', zIndex: 1 }}>
                                        <tr style={{ background: 'white', textAlign: 'left' }}>
                                            <th style={{ padding: '8px 4px', borderBottom: '2px solid #ddd', width: '30px' }}>No.</th>
                                            <th style={{ padding: '8px 4px', borderBottom: '2px solid #ddd' }}>艦名</th>
                                            <th style={{ padding: '8px 4px', borderBottom: '2px solid #ddd' }}>部隊</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sortedShips.map((ship, idx) => {
                                            const isDup = duplicates.has(ship);
                                            return (
                                                <tr
                                                    key={idx}
                                                    style={{ background: isDup ? '#ffe6e6' : 'transparent', cursor: 'pointer' }}
                                                    onClick={() => onSelectUnit && onSelectUnit(ship.unitId, ship.fleetIndex, ship.shipIndex)}
                                                    title="Click to edit unit"
                                                >
                                                    <td style={{ padding: '6px 4px', borderBottom: '1px solid #eee', color: isDup ? 'red' : 'inherit', fontWeight: isDup ? 'bold' : 'normal', textAlign: 'center' }}>
                                                        {ship.number}
                                                    </td>
                                                    <td style={{ padding: '6px 4px', borderBottom: '1px solid #eee', color: isDup ? 'red' : 'inherit', fontWeight: isDup ? 'bold' : 'normal' }}>
                                                        {ship.name}
                                                    </td>
                                                    <td style={{ padding: '6px 4px', borderBottom: '1px solid #eee', fontSize: '0.85em' }}>
                                                        {ship.fleetCode}
                                                        {isDup && <span style={{ color: 'red', display: 'block', fontSize: '0.8em' }}>⚠️重複</span>}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    );
                })}
                {Object.keys(groupedShips).length === 0 && <p style={{ padding: '20px' }}>登録されている艦艇はありません。</p>}
            </div>
        </div>
    );
};

export default ShipListScreen;
