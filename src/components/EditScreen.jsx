import React, { useState, useEffect, useRef } from 'react';
import Draggable from 'react-draggable';
import { parseShipString, formatShipString } from '../utils/parser';

const MAP_WIDTH = 800;
const MAP_HEIGHT = 600;

const EditScreen = ({ units, setUnits, mapImage, onSwitchScreen, selectedUnitId, editingShipIndices, shipTypes, shipClasses, fleetTypes, isSpectator }) => {

    const targetPin = units.find(u => u.id === selectedUnitId);

    // Scroll to highlighted ship
    useEffect(() => {
        if (editingShipIndices && editingShipIndices.fleetIndex !== undefined && editingShipIndices.shipIndex !== undefined) {
            const { fleetIndex, shipIndex } = editingShipIndices;
            const el = document.getElementById(`ship-row-${fleetIndex}-${shipIndex}`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }, [editingShipIndices]);

    const fleets = targetPin ? (targetPin.fleets || []) : [];

    // --- State for Sortable Drag ---
    const [draggingIdx, setDraggingIdx] = useState(null); // Index of the fleet being dragged
    const [placeholderIdx, setPlaceholderIdx] = useState(null); // Current visual position in the list
    const containerRef = useRef(null);
    const CARD_WIDTH = 440; // Approx width (400 + 32 + borders + gaps)

    // Fleetの更新ハンドラ
    const handleFleetChange = (fleetIndex, field, value) => {
        if (isSpectator) return;
        if (!targetPin) return;
        const newFleets = [...fleets];
        let updatedFleet = { ...newFleets[fleetIndex], [field]: value };

        // Auto-generate Name on Code change
        if (field === 'code') {
            const regex = /^(\d{3,4})([A-Z]{1,2})Sq\.$/;
            const match = value.match(regex);
            if (match) {
                const number = match[1];
                const typeCode = match[2];
                const typeObj = fleetTypes.find(t => t.type === typeCode);
                if (typeObj) {
                    updatedFleet.name = `${number}${typeObj.name_of_fleet}`;
                }
            }
        }

        newFleets[fleetIndex] = updatedFleet;
        setUnits(units.map(u => u.id === targetPin.id ? { ...u, fleets: newFleets } : u));
    };

    // 艦艇データの直接更新 (Structured Input)
    const handleShipValueChange = (fleetIndex, shipIndex, field, value) => {
        if (isSpectator) return;
        if (!targetPin) return;

        const newFleets = [...fleets];
        const currentShip = (newFleets[fleetIndex].ships && newFleets[fleetIndex].ships[shipIndex]) || { type: '', classCode: '', number: '', name: '' };

        const updatedShip = { ...currentShip, [field]: value };

        // Ensure ships array exists and is large enough
        if (!newFleets[fleetIndex].ships) newFleets[fleetIndex].ships = [];
        newFleets[fleetIndex].ships[shipIndex] = updatedShip;

        setUnits(units.map(u => u.id === targetPin.id ? { ...u, fleets: newFleets } : u));
    };

    // --- Sortable Handlers ---

    const handleDragStart = (e, index) => {
        if (isSpectator) return;
        // e.stopPropagation(); // Standard practice

        setDraggingIdx(index);
        setPlaceholderIdx(index);
    };

    const handleDrag = (e, data) => {
        // Calculate new placeholder index based on drag position relative to container
        if (!containerRef.current) return;

        // We use the mouse position or element position?
        // data.x is relative to the start position ({0,0}) of this element.
        // But since we shift other elements, their positions change.
        // We really just want the absolute visual index.

        // Simplest: Calculate "Offset in Cards" from start index
        const moveCount = Math.round(data.x / CARD_WIDTH);

        let newIdx = draggingIdx + moveCount;
        newIdx = Math.max(0, Math.min(newIdx, fleets.length - 1));

        if (newIdx !== placeholderIdx) {
            setPlaceholderIdx(newIdx);
        }
    };

    const handleDragStop = (e, data) => {
        if (draggingIdx === null) return;

        if (draggingIdx !== placeholderIdx) {
            // Apply reorder
            const newFleets = [...fleets];
            const [movedFleet] = newFleets.splice(draggingIdx, 1);
            newFleets.splice(placeholderIdx, 0, movedFleet);
            setUnits(units.map(u => u.id === targetPin.id ? { ...u, fleets: newFleets } : u));
        }

        setDraggingIdx(null);
        setPlaceholderIdx(null);
    };

    const handleDeleteFleet = (e, index) => {
        if (!window.confirm("この艦隊を削除してもよろしいですか？")) return;
        const newFleets = [...fleets];
        newFleets.splice(index, 1);
        setUnits(units.map(u => u.id === targetPin.id ? { ...u, fleets: newFleets } : u));
    };


    if (!targetPin) {
        return (
            <div className="screen edit-screen">
                <div className="toolbar">
                    <button className="btn" onClick={onSwitchScreen}>＜ マップ画面へ戻る</button>
                    <span>部隊編集モード</span>
                </div>
                <div style={{ padding: '20px' }}>編集する部隊（ピン）を選択してください。</div>
            </div>
        );
    }

    const gridX = Math.round(targetPin.x - MAP_WIDTH / 2);
    const gridY = Math.round(targetPin.y - MAP_HEIGHT / 2);

    return (
        <div className="screen edit-screen" style={{ flexDirection: 'column' }}>
            <div className="toolbar">
                <button className="btn" onClick={onSwitchScreen}>＜ マップ画面へ戻る</button>
                <span>部隊編集モード：{targetPin.type === 'fleet' ? '艦隊配置' : 'その他'}</span>
                <span style={{ marginLeft: '20px', fontSize: '0.9em' }}>Pos: ({Math.round(targetPin.x)}, {Math.round(targetPin.y)}) / Grid: ({gridX}, {gridY})</span>
            </div>

            <div
                className="grid-container"
                ref={containerRef}
                style={{ display: 'flex', overflowX: 'auto', padding: '20px', gap: '20px', flex: 1, minHeight: 0, position: 'relative' }}
            >
                {/* Pin Info Card (New) - Static */}
                <div className="unit-card" style={{ minWidth: '250px', border: '1px solid #ccc', borderRadius: '8px', padding: '16px', background: '#f0f8ff', display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
                    <h4 style={{ marginTop: 0, marginBottom: '10px' }}>ピン情報</h4>
                    <label style={{ display: 'block', fontSize: '12px' }}>ピン表示名 (マップ上のラベル)</label>
                    <input
                        type="text"
                        value={targetPin.displayName || ''}
                        onChange={(e) => setUnits(units.map(u => u.id === targetPin.id ? { ...u, displayName: e.target.value } : u))}
                        placeholder="名称未設定"
                        style={{ width: '100%', padding: '4px', marginBottom: '10px' }}
                        disabled={isSpectator}
                    />
                    <div style={{ marginBottom: '10px' }}>
                        <label style={{ display: 'block', fontSize: '12px' }}>ピン色設定</label>
                        {!isSpectator ? (
                            <div style={{ display: 'flex', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                                {['#FF0000', '#0000FF', '#008000', '#FFA500', '#800080', '#008080', '#000000', '#FF1493'].map(color => (
                                    <div
                                        key={color}
                                        onClick={() => setUnits(units.map(u => u.id === targetPin.id ? { ...u, color: color } : u))}
                                        style={{
                                            width: '24px', height: '24px', borderRadius: '50%', background: color, cursor: 'pointer',
                                            border: (targetPin.color || '#FF0000') === color ? '3px solid #ccc' : '1px solid #ccc',
                                            boxShadow: (targetPin.color || '#FF0000') === color ? '0 0 5px rgba(0,0,0,0.5)' : 'none'
                                        }}
                                    />
                                ))}
                            </div>
                        ) : <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: targetPin.color || '#FF0000', marginTop: '4px' }}></div>}
                    </div>
                    <div className="mini-map" style={{ width: '100%', height: '150px', background: '#ccc', overflow: 'hidden', position: 'relative', borderRadius: '4px', flexShrink: 0, marginTop: 'auto' }}>
                        {mapImage && (
                            <img
                                src={mapImage}
                                alt="mini-map"
                                style={{
                                    position: 'absolute',
                                    left: `${-targetPin.x + 125}px`,
                                    top: `${-targetPin.y + 75}px`,
                                    maxWidth: 'none'
                                }}
                            />
                        )}
                        <div style={{
                            position: 'absolute', top: '50%', left: '50%', width: '10px', height: '10px', border: `2px solid ${targetPin.color || 'red'}`, borderRadius: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none', backgroundColor: 'white'
                        }}></div>
                    </div>
                </div>

                {/* Visible Fleets */}
                {fleets.map((fleet, index) => {
                    const isDragging = index === draggingIdx;

                    // --- Shuffle Logic ---
                    // Calculate visual shift based on placeholderIdx
                    let shiftX = 0;
                    if (draggingIdx !== null && !isDragging) {
                        if (index > draggingIdx && index <= placeholderIdx) {
                            // Moved to Right: Shift Left
                            shiftX = -CARD_WIDTH;
                        } else if (index < draggingIdx && index >= placeholderIdx) {
                            // Moved to Left: Shift Right
                            shiftX = CARD_WIDTH;
                        }
                    }

                    return (
                        <div
                            key={fleet.id || index}
                            style={{
                                transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.2, 1, 0.1, 1)',
                                transform: `translate3d(${shiftX}px, 0, 0)`,
                                zIndex: isDragging ? 100 : 0
                            }}
                        >
                            <Draggable
                                axis="x"
                                position={isDragging ? undefined : { x: 0, y: 0 }} // Lock others to 0
                                defaultPosition={{ x: 0, y: 0 }}
                                onStart={(e) => handleDragStart(e, index)}
                                onDrag={handleDrag}
                                onStop={handleDragStop}
                                disabled={isSpectator}
                                handle=".drag-handle"
                            >
                                <div
                                    className="unit-card"
                                    style={{
                                        minWidth: '400px',
                                        width: '400px', // Explicit width
                                        border: '1px solid #ccc',
                                        borderRadius: '8px',
                                        padding: '0 16px 16px 16px',
                                        background: '#fff',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        boxShadow: isDragging ? '0 15px 30px rgba(0,0,0,0.25)' : 'none',
                                        cursor: isDragging ? 'grabbing' : 'auto'
                                    }}
                                >
                                    {/* Drag Handle */}
                                    {!isSpectator && (
                                        <div
                                            className="drag-handle"
                                            style={{
                                                height: '20px',
                                                background: isDragging ? '#ddd' : '#eee',
                                                margin: '0 -16px 10px -16px',
                                                borderTopLeftRadius: '8px',
                                                borderTopRightRadius: '8px',
                                                cursor: isDragging ? 'grabbing' : 'grab',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                position: 'relative'
                                            }}
                                            title="ドラッグして並び替え"
                                        >
                                            <div style={{ width: '30px', height: '4px', borderTop: '2px solid #ccc', borderBottom: '2px solid #ccc' }}></div>
                                            <button
                                                onClick={(e) => handleDeleteFleet(e, index)}
                                                style={{
                                                    position: 'absolute',
                                                    right: '8px',
                                                    top: '2px',
                                                    background: 'transparent',
                                                    border: 'none',
                                                    color: 'red',
                                                    cursor: 'pointer',
                                                    fontSize: '12px',
                                                    fontWeight: 'bold'
                                                }}
                                            >
                                                × 削除
                                            </button>
                                        </div>
                                    )}
                                    {isSpectator && <div style={{ height: '16px' }}></div>}

                                    {/* 部隊コード & 名前 */}
                                    <div style={{ marginBottom: '10px' }}>
                                        <label style={{ display: 'block', fontSize: '12px' }}>部隊コード / 部隊名</label>
                                        {!isSpectator ? (
                                            <>
                                                <input
                                                    type="text"
                                                    value={fleet.code || ''}
                                                    onChange={(e) => handleFleetChange(index, 'code', e.target.value)}
                                                    style={{ width: '100%', padding: '4px', marginBottom: '8px' }}
                                                    placeholder="Code"
                                                />
                                                <input
                                                    type="text"
                                                    value={fleet.name || ''}
                                                    onChange={(e) => handleFleetChange(index, 'name', e.target.value)}
                                                    style={{ width: '100%', padding: '4px' }}
                                                    placeholder="Name"
                                                />
                                            </>
                                        ) : (
                                            <div style={{ padding: '4px' }}>
                                                <div style={{ fontWeight: 'bold' }}>{fleet.code || '-'}</div>
                                                <div>{fleet.name || '-'}</div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Symbol Image Upload */}
                                    <div style={{ marginBottom: '10px', padding: '10px', border: '1px dashed #ccc', borderRadius: '4px', textAlign: 'center' }}>
                                        {fleet.symbolImage ? (
                                            <div style={{ position: 'relative', display: 'inline-block' }}>
                                                <img src={fleet.symbolImage} alt="Symbol" style={{ maxHeight: '80px', maxWidth: '100%' }} />
                                                {!isSpectator && (
                                                    <button
                                                        onClick={() => handleFleetChange(index, 'symbolImage', null)}
                                                        style={{ position: 'absolute', top: 0, right: 0, background: 'red', color: 'white', border: 'none', cursor: 'pointer', borderRadius: '50%', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                    >
                                                        ×
                                                    </button>
                                                )}
                                            </div>
                                        ) : (
                                            !isSpectator && (
                                                <label style={{ cursor: 'pointer', display: 'block', padding: '10px', color: '#666' }}>
                                                    + 部隊画像を追加
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        hidden
                                                        onChange={(e) => {
                                                            const file = e.target.files[0];
                                                            if (file) {
                                                                const reader = new FileReader();
                                                                reader.onload = (ev) => handleFleetChange(index, 'symbolImage', ev.target.result);
                                                                reader.readAsDataURL(file);
                                                            }
                                                        }}
                                                    />
                                                </label>
                                            )
                                        )}
                                        {isSpectator && !fleet.symbolImage && <span style={{ color: '#ccc' }}>画像なし</span>}
                                    </div>

                                    {/* 艦艇リスト */}
                                    <div className="ship-list" style={{ flex: 1, overflowY: 'auto' }}>
                                        <h4 style={{ margin: '0 0 8px' }}>構成艦艇</h4>
                                        <div style={{ display: 'grid', gridTemplateColumns: '20px 60px 80px 40px 1fr', gap: '4px', fontSize: '10px', color: '#666', marginBottom: '4px' }}>
                                            <span>#</span><span>種別</span><span>型</span><span>番号</span><span>名前</span>
                                        </div>

                                        {[...Array(8)].map((_, i) => {
                                            const ship = (fleet.ships && fleet.ships[i]) || { type: '', classCode: '', number: '', name: '' };
                                            const availableClasses = shipClasses.filter(c => c.ship_type_index === ship.type);
                                            const isHighlighted = editingShipIndices && editingShipIndices.fleetIndex === index && editingShipIndices.shipIndex === i;

                                            return (
                                                <div
                                                    key={i}
                                                    id={`ship-row-${index}-${i}`}
                                                    style={{
                                                        display: 'grid', gridTemplateColumns: '20px 60px 80px 40px 1fr', gap: '4px', marginBottom: '4px', alignItems: 'center',
                                                        background: isHighlighted ? '#fffacd' : 'transparent',
                                                        border: isHighlighted ? '2px solid orange' : 'none',
                                                        padding: isHighlighted ? '2px' : '0',
                                                        borderRadius: '4px',
                                                        transition: 'background 0.5s'
                                                    }}
                                                >
                                                    <span style={{ textAlign: 'right' }}>{i + 1}.</span>
                                                    {!isSpectator ? (
                                                        <select
                                                            value={ship.type}
                                                            onChange={(e) => handleShipValueChange(index, i, 'type', e.target.value)}
                                                            style={{ fontSize: '11px', padding: '2px' }}
                                                        >
                                                            <option value="">-</option>
                                                            {shipTypes.map(t => {
                                                                const hasClasses = shipClasses.some(c => c.ship_type_index === t.ship_type_index);
                                                                return <option key={t.ship_type_index} value={t.ship_type_index} disabled={!hasClasses}>{t.ship_type_index}</option>
                                                            })}
                                                        </select>
                                                    ) : <span style={{ fontSize: '11px' }}>{ship.type || '-'}</span>}

                                                    {!isSpectator ? (
                                                        <select
                                                            value={ship.classCode}
                                                            onChange={(e) => handleShipValueChange(index, i, 'classCode', e.target.value)}
                                                            style={{ fontSize: '11px', padding: '2px' }}
                                                        >
                                                            <option value="">-</option>
                                                            {availableClasses.map(c => <option key={c.ship_class_index} value={c.ship_class_index}>{c.ship_class_index}</option>)}
                                                        </select>
                                                    ) : <span style={{ fontSize: '11px' }}>{ship.classCode || '-'}</span>}

                                                    {!isSpectator ? (
                                                        <input type="text" value={ship.number} onChange={(e) => handleShipValueChange(index, i, 'number', e.target.value)} style={{ fontSize: '11px', padding: '2px', textAlign: 'center' }} />
                                                    ) : <span style={{ fontSize: '11px', textAlign: 'center' }}>{ship.number || ''}</span>}

                                                    {!isSpectator ? (
                                                        <input type="text" value={ship.name} onChange={(e) => handleShipValueChange(index, i, 'name', e.target.value)} placeholder="艦名" style={{ fontSize: '11px', padding: '2px' }} />
                                                    ) : <span style={{ fontSize: '11px' }}>{ship.name || ''}</span>}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* 備考 (Tall) */}
                                    {!isSpectator ? (
                                        <textarea
                                            placeholder="備考"
                                            value={fleet.remarks || ''}
                                            onChange={(e) => handleFleetChange(index, 'remarks', e.target.value)}
                                            style={{ width: '100%', marginTop: '10px', height: '180px', padding: '4px', flexShrink: 0, resize: 'none' }}
                                        />
                                    ) : (
                                        <div style={{ width: '100%', marginTop: '10px', padding: '4px', background: '#f5f5f5', borderRadius: '4px', minHeight: '40px', fontSize: '0.9em' }}>
                                            {fleet.remarks || '(備考なし)'}
                                        </div>
                                    )}
                                </div>
                            </Draggable>
                        </div>
                    );
                })}

                {/* Add Button */}
                {!isSpectator && draggingIdx === null && (
                    <div
                        className="unit-card add-card"
                        onClick={() => {
                            const newFleets = [...fleets, { id: Date.now(), code: 'New', name: '', ships: [], remarks: '' }];
                            setUnits(units.map(u => u.id === targetPin.id ? { ...u, fleets: newFleets } : u));
                        }}
                        style={{ minWidth: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: '2px dashed #ccc', borderRadius: '8px', background: '#f9f9f9' }}
                    >
                        <span style={{ fontSize: '24px', color: '#999' }}>+ 追加</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default EditScreen;
