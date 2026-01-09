import React, { useState, useEffect } from 'react';

const FleetSplitScreen = ({ units, setUnits, onSwitchScreen, selectedUnitId, shipTypes, shipClasses, isSpectator }) => {
    const sourceUnit = units.find(u => u.id === selectedUnitId);

    // Initial state setup
    const [sourceFleets, setSourceFleets] = useState([]);
    const [newFleets, setNewFleets] = useState([]);

    useEffect(() => {
        if (sourceUnit && sourceUnit.fleets) {
            // Deep copy to avoid mutating original state until save
            setSourceFleets(JSON.parse(JSON.stringify(sourceUnit.fleets)));
            // Initialize new fleet with one empty fleet
            setNewFleets([]);
        }
    }, [sourceUnit]);

    // Format ship name for display
    const formatShip = (ship) => {
        const typeObj = shipTypes.find(t => t.ship_type_index === ship.type);
        const typeName = typeObj?.name_of_type || ship.type;
        // ShipID: Type-ClassCode+Number (e.g. DD-AK01)
        const shipId = `${ship.type || ''}-${ship.classCode || ''}${ship.number || ''}`;
        return `${typeName} ${shipId} ${ship.name}`;
    };

    // --- Drag and Drop Handlers ---

    // dataTransfer format: JSON string 
    // { level: 'ship'|'fleet', origin: 'source'|'new', fleetIndex: number, shipIndex: number }
    const handleDragStart = (e, level, origin, fleetIndex, shipIndex = null) => {
        e.dataTransfer.setData('application/json', JSON.stringify({ level, origin, fleetIndex, shipIndex }));
        e.dataTransfer.effectAllowed = 'move';
        e.stopPropagation(); // Prevent fleet drag when dragging ship
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    // Unified Drop Handler for FleetBox
    const handleFleetOrShipDrop = (e, targetOrigin, targetFleetIndex) => {
        e.preventDefault();
        e.stopPropagation();
        const dataStr = e.dataTransfer.getData('application/json');
        if (!dataStr) return;

        try {
            const { level, origin, fleetIndex, shipIndex } = JSON.parse(dataStr);

            if (level === 'ship') {
                handleShipDropIntoFleet(e, targetOrigin, targetFleetIndex, { origin, fleetIndex, shipIndex });
            } else if (level === 'fleet') {
                handleFleetReorder(origin, fleetIndex, targetOrigin, targetFleetIndex);
            }
        } catch (err) {
            console.error(err);
        }
    };

    const handleFleetReorder = (origin, sourceIndex, targetOrigin, targetIndex) => {
        let sourceList = origin === 'source' ? [...sourceFleets] : [...newFleets];
        let targetList = targetOrigin === 'source' ? [...sourceFleets] : [...newFleets];

        // If same list, just reorder
        if (origin === targetOrigin) {
            const list = origin === 'source' ? [...sourceFleets] : [...newFleets];
            const [movedFleet] = list.splice(sourceIndex, 1);
            list.splice(targetIndex, 0, movedFleet);

            if (origin === 'source') setSourceFleets(list);
            else setNewFleets(list);
        } else {
            // Check if we need to account for removals affecting addition?
            // Moving from Source to New (or vice versa) AND inserting at specific index.

            // 1. Remove from source
            const [movedFleet] = sourceList.splice(sourceIndex, 1);

            // 2. Add to target
            targetList.splice(targetIndex, 0, movedFleet);

            // Update states
            if (origin === 'source') setSourceFleets(sourceList);
            else setNewFleets(sourceList);

            if (targetOrigin === 'source') setSourceFleets(targetList);
            else setNewFleets(targetList);
        }
    };

    // Refactored Ship Drop (Extracted)
    const handleShipDropIntoFleet = (e, targetOrigin, targetFleetIndex, data) => {
        const { origin, fleetIndex, shipIndex } = data;
        if (origin === targetOrigin && fleetIndex === targetFleetIndex) return;

        let sourceList = origin === 'source' ? [...sourceFleets] : [...newFleets];
        let shipToMove = null;

        if (sourceList[fleetIndex] && sourceList[fleetIndex].ships) {
            shipToMove = sourceList[fleetIndex].ships[shipIndex];
            sourceList[fleetIndex].ships.splice(shipIndex, 1);
        }
        if (!shipToMove) return;

        // Update removal
        if (origin === 'source') setSourceFleets(sourceList);
        else setNewFleets(sourceList);

        // Add to target
        let targetList = targetOrigin === 'source' ? (origin === 'source' ? sourceList : [...sourceFleets]) : (origin === 'new' ? sourceList : [...newFleets]);
        if (!targetList[targetFleetIndex].ships) targetList[targetFleetIndex].ships = [];
        targetList[targetFleetIndex].ships.push(shipToMove);

        // Update addition
        if (targetOrigin === 'source') setSourceFleets(targetList);
        else setNewFleets(targetList);
    };

    // Drop handler for dropping INTO A PANE (accepts fleets)
    const handleFleetDropIntoPane = (e, targetOrigin) => {
        e.preventDefault();
        const dataStr = e.dataTransfer.getData('application/json');
        if (!dataStr) return;

        try {
            const { level, origin, fleetIndex } = JSON.parse(dataStr);

            if (level !== 'fleet') return;
            if (origin === targetOrigin) return; // Reordering not implemented yet, just ignore

            // Move entire fleet
            let fleetToMove = null;
            let sourceList = origin === 'source' ? [...sourceFleets] : [...newFleets];

            if (sourceList[fleetIndex]) {
                fleetToMove = sourceList[fleetIndex];
                sourceList.splice(fleetIndex, 1);
            }

            if (!fleetToMove) return;

            // Update source
            if (origin === 'source') setSourceFleets(sourceList);
            else setNewFleets(sourceList);

            // Add to target
            let targetList = targetOrigin === 'source' ? [...sourceFleets] : [...newFleets];
            // If we just updated sourceFleets above and target is source, we're good (but loop condition says origin!=targetOrigin)
            // Wait, if I drop into source, and origin was source, I returned early. So safe.

            // If origin was source, and target is new: sourceList updated (removed). targetList (newFleets) needs update.
            // If origin was new, and target is source: sourceList updated (removed). targetList (sourceFleets) needs update.
            // Careful about async state updates if both setFleets called?
            // Actually they are distinct states.

            targetList.push(fleetToMove);

            if (targetOrigin === 'source') setSourceFleets(targetList);
            else setNewFleets(targetList);

        } catch (err) {
            console.error("Fleet Drop error", err);
        }
    };

    const handleExecuteSplit = () => {
        if (!sourceUnit) return;

        const newUnitId = Date.now();

        // 1. Update Source Unit
        const updatedSourceUnit = {
            ...sourceUnit,
            fleets: sourceFleets
        };

        // 2. Create New Unit
        // Positioned to the left of source (-100px or so)
        const newUnit = {
            id: newUnitId,
            type: 'fleet',
            x: sourceUnit.x - 100,
            y: sourceUnit.y,
            displayName: 'New Split Fleet',
            fleets: newFleets,
            color: sourceUnit.color || '#FF0000'
        };

        // 3. Update Global State
        // Remove old source unit, add updated source unit and new unit
        const updatedUnits = units.map(u => u.id === sourceUnit.id ? updatedSourceUnit : u);
        updatedUnits.push(newUnit);

        setUnits(updatedUnits);
        onSwitchScreen(); // Return to main
    };

    if (!sourceUnit) return <div>Invalid Unit</div>;

    return (
        <div className="screen split-screen" style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#f5f5f5' }}>
            <div className="toolbar" style={{ padding: '10px', background: 'white', borderBottom: '1px solid #ccc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button className="btn" onClick={onSwitchScreen}>キャンセル</button>
                    <span style={{ fontWeight: 'bold' }}>艦隊分割モード</span>
                </div>
                <button className="btn" onClick={handleExecuteSplit} style={{ background: '#007bff', color: 'white' }}>分割を実行</button>
            </div>

            <div className="split-container" style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '20px', gap: '20px', overflow: 'hidden' }}>

                {/* Top: Source Fleets */}
                <div
                    className="source-pane"
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleFleetDropIntoPane(e, 'source')}
                    style={{ flex: 1, background: 'white', border: '1px solid #ccc', borderRadius: '8px', padding: '10px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}
                >
                    <h3 style={{ margin: '0 0 10px 0', borderBottom: '2px solid red' }}>分割元艦隊 (移動前)</h3>
                    {sourceFleets.map((fleet, fIdx) => (
                        <div
                            key={fIdx}
                            className="fleet-box"
                            draggable={!isSpectator}
                            onDragStart={(e) => handleDragStart(e, 'fleet', 'source', fIdx)}
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleFleetOrShipDrop(e, 'source', fIdx)}
                            style={{ border: '1px solid #eee', padding: '10px', marginBottom: '10px', background: '#fff', cursor: 'grab' }}
                        >
                            <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>{fleet.code} {fleet.name}</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', minHeight: '30px', background: '#fafafa', padding: '5px' }}>
                                {(fleet.ships || []).map((ship, sIdx) => {
                                    // Ship Card
                                    return (
                                        <div
                                            key={sIdx}
                                            draggable={!isSpectator}
                                            onDragStart={(e) => handleDragStart(e, 'ship', 'source', fIdx, sIdx)}
                                            style={{
                                                padding: '4px 8px', background: 'white', border: '1px solid #ccc', borderRadius: '4px', cursor: 'grab',
                                                fontSize: '0.9em', boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
                                            }}
                                        >
                                            {formatShip(ship)}
                                        </div>
                                    );
                                })}
                                {(fleet.ships?.length === 0) && <div style={{ color: '#ccc', fontSize: '0.8em' }}>ドラッグして艦船を追加</div>}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Divider Icon */}
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    <span style={{ fontSize: '2em' }}>⇅</span>
                </div>

                {/* Bottom: New Fleets */}
                <div
                    className="new-pane"
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleFleetDropIntoPane(e, 'new')}
                    style={{ flex: 1, background: 'white', border: '1px solid #ccc', borderRadius: '8px', padding: '10px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}
                >
                    <h3 style={{ margin: '0 0 10px 0', borderBottom: '2px solid blue' }}>新規艦隊 (移動後)</h3>
                    {newFleets.map((fleet, fIdx) => (
                        <div
                            key={fIdx}
                            className="fleet-box"
                            draggable={!isSpectator}
                            onDragStart={(e) => handleDragStart(e, 'fleet', 'new', fIdx)}
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleFleetOrShipDrop(e, 'new', fIdx)}
                            style={{ border: '1px solid #eee', padding: '10px', marginBottom: '10px', background: '#fff', cursor: 'grab' }}
                        >
                            <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>{fleet.code} {fleet.name}</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', minHeight: '30px', background: '#fafafa', padding: '5px' }}>
                                {(fleet.ships || []).map((ship, sIdx) => {
                                    return (
                                        <div
                                            key={sIdx}
                                            draggable={!isSpectator}
                                            onDragStart={(e) => handleDragStart(e, 'ship', 'new', fIdx, sIdx)}
                                            style={{
                                                padding: '4px 8px', background: '#e6f7ff', border: '1px solid #91d5ff', borderRadius: '4px', cursor: 'grab',
                                                fontSize: '0.9em', boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
                                            }}
                                        >
                                            {formatShip(ship)}
                                        </div>
                                    );
                                })}
                                {(fleet.ships?.length === 0) && <div style={{ color: '#ccc', fontSize: '0.8em' }}>ドラッグして艦船を追加</div>}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default FleetSplitScreen;
