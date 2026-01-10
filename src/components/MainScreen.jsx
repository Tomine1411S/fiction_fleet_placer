import React, { useState, useRef, useEffect } from 'react';
import Draggable from 'react-draggable';
import { saveAs } from 'file-saver';

const MainScreen = ({ units = [], setUnits, mapImage, onSwitchScreen, onOpenSettings, onOpenShipList, onFileUpload, onSaveZip, onDownloadReport, selectedUnitId, setSelectedUnitId, fleetTypes, isSpectator, sessionId, onOpenSplitScreen }) => {
    // const [selectedUnitId, setSelectedUnitId] = useState(null); // Now from props
    const [hoveredUnitId, setHoveredUnitId] = useState(null);
    const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, unitId: null, isBackground: false });
    const [clipboard, setClipboard] = useState(null);
    const [tab, setTab] = useState('file');

    // Zoom/Pan State
    const [scale, setScale] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDraggingMap, setIsDraggingMap] = useState(false);
    const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
    const [showDownloadModal, setShowDownloadModal] = useState(false);
    const [showShareModal, setShowShareModal] = useState(false);
    const [mergeCandidate, setMergeCandidate] = useState(null);
    const [showShapeMenu, setShowShapeMenu] = useState(false);

    // --- Download Handlers ---
    const handleDownloadTXT = () => {
        try {
            let text = "";
            units.forEach(unit => {
                if (unit.type === 'fleet' || !unit.type) { // Include only fleet pins
                    // Pin Name
                    const pinName = unit.displayName || (unit.fleets || []).map(f => f.code).join(' + ') || 'No Name';
                    text += `・${pinName}\n`;

                    (unit.fleets || []).forEach(fleet => {
                        // Fleet Name line
                        text += `　・${fleet.name || 'No Name'}\n`;

                        (fleet.ships || []).forEach((ship) => {
                            // Ship Line
                            const shipId = `${ship.type || ''}-${ship.classCode || ''}${ship.number || ''}`;
                            text += `　　・${shipId} ${ship.name || 'No Name'}\n`;
                        });
                    });
                }
            });
            const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
            saveAs(blob, "fleet_structure.txt");
            setShowDownloadModal(false);
        } catch (error) {
            console.error(error);
            alert("ダウンロード中にエラーが発生しました: " + error.message);
        }
    };

    const handleDownloadCSV = () => {
        try {
            let csv = "no,pin-name,fleet-name,fleet-ID,fleet-type,ship-num-in-fleet,ship-name,ship-ID\n";
            let globalNo = 1;

            units.forEach(unit => {
                if (unit.type === 'fleet' || !unit.type) {
                    const pinName = unit.displayName || (unit.fleets || []).map(f => f.code).join(' + ') || 'No Name';

                    (unit.fleets || []).forEach(fleet => {
                        // Determine Fleet Type (T, D, etc.)
                        let fType = "";
                        if (fleet.code) {
                            const match = fleet.code.match(/(\d+)([A-Z]+)Sq\./);
                            if (match) fType = match[2];
                        }

                        (fleet.ships || []).forEach((ship, idx) => {
                            const shipId = `${ship.type || ''}-${ship.classCode || ''}${ship.number || ''}`;
                            const line = [
                                globalNo++,
                                pinName,
                                fleet.name || '',
                                fleet.code || '',
                                fType,
                                idx + 1,
                                ship.name || '',
                                shipId
                            ].map(v => `"${v}"`).join(","); // Quote all fields
                            csv += line + "\n";
                        });
                    });
                }
            });
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
            saveAs(blob, "fleet_detail.csv");
            setShowDownloadModal(false);
        } catch (error) {
            console.error(error);
            alert("ダウンロード中にエラーが発生しました: " + error.message);
        }
    };

    // Search State
    const [searchQuery, setSearchQuery] = useState('');

    // Search Logic
    const searchResults = React.useMemo(() => {
        if (!searchQuery.trim()) return [];
        const lowerQuery = searchQuery.toLowerCase();
        return units.filter(u => {
            if (u.type && u.type !== 'fleet') return false; // Only search fleets for now? Or labels too? Let's include labels if text matches
            if (u.type === 'label' && u.text && u.text.toLowerCase().includes(lowerQuery)) return true;

            // Display Name
            if (u.displayName && u.displayName.toLowerCase().includes(lowerQuery)) return true;

            // Fleets
            if (u.fleets) {
                return u.fleets.some(f => {
                    if (f.code && f.code.toLowerCase().includes(lowerQuery)) return true;
                    if (f.name && f.name.toLowerCase().includes(lowerQuery)) return true;
                    // Ships
                    if (f.ships) {
                        return f.ships.some(s => {
                            if (s.name && s.name.toLowerCase().includes(lowerQuery)) return true;
                            if (s.number && s.number.includes(lowerQuery)) return true;
                            const fullStr = `${s.type}-${s.classCode}${s.number}`.toLowerCase();
                            if (fullStr.includes(lowerQuery)) return true;
                            return false;
                        });
                    }
                    return false;
                });
            }
            return false;
        });
    }, [units, searchQuery]);

    const handleSearchResultClick = (unit) => {
        setSelectedUnitId(unit.id);
        // Center Map
        // cx = (400 - position.x) / scale  <- this is converting screen to map
        // We want map (unit.x, unit.y) to be at screen center (400, 300)
        // 400 = unit.x * scale + position.x
        // position.x = 400 - unit.x * scale
        setPosition({
            x: 400 - unit.x * scale,
            y: 300 - unit.y * scale
        });
    };

    // Refs for map dimensions
    const mapImgRef = useRef(null);

    const activeUnit = units.find(u => u.id === (selectedUnitId || hoveredUnitId));

    // --- Map Control Handlers ---
    const handleWheel = (e) => {
        if (e.ctrlKey || e.metaKey || true) { // Always zoom on wheel for now
            e.preventDefault();
            const scaleAmount = -e.deltaY * 0.001;
            const newScale = Math.min(Math.max(0.1, scale + scaleAmount), 5);
            setScale(newScale);
        }
    };

    const handleMouseDown = (e) => {
        // Space key or Middle click for pan
        if (e.button === 1 || (e.button === 0 && e.nativeEvent.getModifierState('Space'))) { // Middle click or Space+Left
            e.preventDefault();
            setIsDraggingMap(true);
            setLastMousePos({ x: e.clientX, y: e.clientY });
        }
    };

    const handleMouseMove = (e) => {
        if (isDraggingMap) {
            const dx = e.clientX - lastMousePos.x;
            const dy = e.clientY - lastMousePos.y;
            setPosition({ x: position.x + dx, y: position.y + dy });
            setLastMousePos({ x: e.clientX, y: e.clientY });
        }
    };

    const handleMouseUp = () => {
        setIsDraggingMap(false);
    };

    // Automatically center/fit map on image load
    useEffect(() => {
        if (mapImgRef.current && mapImage) {
            // Reset position on new map load?
            // Maybe just center it.
            setPosition({ x: 0, y: 0 });
        }
    }, [mapImage]);

    // --- Context Menu Handlers ---

    const handleContextMenu = (e, unitId) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ visible: true, x: e.pageX, y: e.pageY, unitId, isBackground: false });
    };

    const handleMapContextMenu = (e) => {
        e.preventDefault();
        setContextMenu({ visible: true, x: e.pageX, y: e.pageY, unitId: null, isBackground: true });
    };

    const closeContextMenu = () => setContextMenu({ ...contextMenu, visible: false });

    // --- Action Handlers ---

    const handleMenuAction = (action) => {
        const targetUnit = units.find(u => u.id === contextMenu.unitId);

        if (action === 'delete') {
            setUnits(units.filter(u => u.id !== contextMenu.unitId));
        }
        else if (action === 'copy' && targetUnit) {
            setClipboard({ ...targetUnit, id: Date.now() });
        }
        else if (action === 'cut' && targetUnit) {
            setClipboard({ ...targetUnit, id: Date.now() });
            setUnits(units.filter(u => u.id !== contextMenu.unitId));
        }
        else if (action === 'edit' && targetUnit) {
            setSelectedUnitId(targetUnit.id);
            onSwitchScreen();
        }
        else if (action === 'paste' && clipboard) {
            // Paste at map center or relative to click?
            // Simplified: Add slightly offset from current center
            // Need to reverse transform to get map coordinates?
            // For now, paste at (0,0) or (100,100)
            const newUnit = {
                ...clipboard,
                id: Date.now(),
                x: -position.x / scale + 100, // approximate center logic 
                y: -position.y / scale + 100
            };
            setUnits([...units, newUnit]);
        }
        else if (action === 'add_fleet' && targetUnit) {
            // Add another fleet to this pin
            // Ensure targetUnit.fleets exists
            if (!targetUnit.fleets) targetUnit.fleets = [];
            targetUnit.fleets.push({
                id: Date.now(),
                code: 'New',
                name: '',
                ships: [],
                remarks: ''
            });
            setUnits([...units]); // Trigger update

            // Auto open edit?
            setSelectedUnitId(targetUnit.id);
            onSwitchScreen();
        }
        else if (action === 'split' && targetUnit) {
            setSelectedUnitId(targetUnit.id);
            onOpenSplitScreen();
        }

        closeContextMenu();
    };

    const handleAddUnit = (type) => {
        const newId = Date.now();
        // 中心座標に配置 (View center)
        // ViewCenter (screen) -> MapCoords
        // centerScreenX = 400 (half of 800 container), Y=300
        // mapX = (centerScreenX - tx) / scale
        const cx = (400 - position.x) / scale;
        const cy = (300 - position.y) / scale;

        let newUnit = { id: newId, x: cx, y: cy, type };

        if (type === 'fleet') {
            newUnit = {
                ...newUnit,
                fleets: [{ id: newId + 1, code: 'NewUnit', name: 'New Fleet', ships: [], remarks: '' }]
            };
        } else if (type === 'label') {
            newUnit = { ...newUnit, text: 'Label', fontSize: 16, color: 'black', rotation: 0 };
        } else if (['circle', 'rect', 'triangle', 'convex'].includes(type)) {
            newUnit = {
                ...newUnit,
                type: 'shape',
                shapeType: type,
                width: 100,
                height: 100,
                color: '#aaaaaa',
                rotation: 0,
                opacity: 0.8
            };
        } else if (type === 'line') {
            newUnit = {
                id: newId, x: 0, y: 0,
                type: 'line',
                points: [{ x: cx - 50, y: cy }, { x: cx + 50, y: cy }],
                color: '#FF0000',
                arrow: true,
                width: 3
            };
        } else if (type === 'image') {
            document.getElementById('add-image-input').click();
            return;
        }
        setUnits([...units, newUnit]);
    };

    const handleAddImageUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const url = URL.createObjectURL(file);
            const cx = (400 - position.x) / scale;
            const cy = (300 - position.y) / scale;
            const newUnit = { id: Date.now(), x: cx, y: cy, type: 'image', src: url, width: 100 };
            setUnits([...units, newUnit]);
        }
    };

    // Image load handler to adjust map size/coords if needed
    // But currently using CSS transform, so maybe just ensure it displays correctly.

    const copyLink = async (type) => {
        try {
            const url = new URL(window.location.href);

            if (type === 'spectator') {
                // For spectator, we use the spectatorShareId if available
                // If we are already a spectator, our sessionId IS the spectator ID.
                const idToShare = isSpectator ? sessionId : spectatorShareId;
                if (idToShare) {
                    url.searchParams.set('session', idToShare);
                } else {
                    alert("観戦用IDがまだ取得できていません。少し待ってから再度お試しください。");
                    return;
                }
                // Enhance UX by setting mode param (though server enforces security via ID)
                url.searchParams.set('mode', 'spectator');
            } else {
                // For edit link (only available if we are editor)
                url.searchParams.set('session', sessionId);
                url.searchParams.delete('mode');
            }

            await navigator.clipboard.writeText(url.toString());
            alert(`${type === 'spectator' ? '観戦' : '共有'}リンクをクリップボードにコピーしました`);
        } catch (err) {
            console.error("Clipboard failed:", err);
            alert("クリップボードへのコピーに失敗しました。\nURLを手動でコピーしてください:\n" + window.location.href);
        }
    };

    return (
        <div className="screen main-screen" onClick={closeContextMenu}>
            {/* Sidebar */}
            <div className="sidebar" style={{ width: '250px', background: '#f0f0f0', padding: '10px', overflowY: 'auto' }}>
                <h3>情報パネル</h3>
                {activeUnit ? (
                    <div>
                        <div style={{ marginBottom: '10px' }}>
                            <strong>ID:</strong> {activeUnit.id}
                        </div>

                        {/* Fleet Unit */}
                        {(activeUnit.type === 'fleet' || !activeUnit.type) && (
                            <div>
                                <h4 style={{ margin: '5px 0' }}>構成部隊</h4>
                                {(activeUnit.fleets || []).map((f, i) => {
                                    const match = f.code ? f.code.match(/^(\d{3,4})([A-Z]+)Sq\.$/) : null;
                                    const typeCode = match ? match[2] : null;
                                    const emblemSrc = f.symbolImage || (typeCode ? `/assets/ships/${typeCode}.png` : null);

                                    return (
                                        <div key={i} style={{ background: 'white', margin: '10px 0', padding: '10px', border: '1px solid #ccc', borderRadius: '4px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                                <strong style={{ fontSize: '1.1em' }}>{f.code}</strong>
                                                {emblemSrc && (
                                                    <img
                                                        src={emblemSrc}
                                                        alt=""
                                                        style={{ height: '1.5em', maxWidth: '3em', objectFit: 'contain' }}
                                                        onError={(e) => e.target.style.display = 'none'}
                                                    />
                                                )}
                                            </div>
                                            <div style={{ borderBottom: '1px solid #eee', paddingBottom: '4px', marginBottom: '8px' }}>
                                                {f.name}
                                            </div>

                                            {(f.ships || []).map((s, si) => (
                                                <div key={si} style={{ fontSize: '0.9em', marginLeft: '5px' }}>
                                                    {`${s.type || ''}-${s.classCode || ''}${s.number || ''}`} {s.name}
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Line Unit */}
                        {/* Line Unit */}
                        {activeUnit.type === 'line' && (
                            <div>
                                <h4 style={{ margin: '5px 0' }}>ライン設定</h4>
                                <div style={{ marginBottom: '10px' }}>
                                    <label>色:</label>
                                    <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginTop: '5px' }}>
                                        {['#FF0000', '#0000FF', '#008000', '#FFA500', '#800080', '#008080', '#000000', '#FF1493'].map(c => (
                                            <div key={c}
                                                onClick={() => !isSpectator && setUnits(units.map(u => u.id === activeUnit.id ? { ...u, color: c } : u))}
                                                style={{
                                                    width: '20px', height: '20px', background: c, borderRadius: '50%',
                                                    border: activeUnit.color === c ? '2px solid black' : '1px solid #ccc',
                                                    cursor: isSpectator ? 'default' : 'pointer'
                                                }}
                                            />
                                        ))}
                                    </div>
                                </div>

                                {!isSpectator && (
                                    <>
                                        <label style={{ display: 'block', marginBottom: '5px' }}>
                                            <input type="checkbox"
                                                checked={activeUnit.points && activeUnit.points.length === 3}
                                                onChange={(e) => {
                                                    const isCurve = e.target.checked;
                                                    let newPoints = [...(activeUnit.points || [])];
                                                    if (isCurve && newPoints.length === 2) {
                                                        const p1 = newPoints[0];
                                                        const p2 = newPoints[1];
                                                        newPoints.splice(1, 0, { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 - 50 });
                                                    } else if (!isCurve && newPoints.length === 3) {
                                                        newPoints.splice(1, 1);
                                                    }
                                                    setUnits(units.map(u => u.id === activeUnit.id ? { ...u, points: newPoints } : u));
                                                }}
                                            /> 曲線化 (Curve)
                                        </label>
                                        <label style={{ display: 'block' }}>
                                            <input type="checkbox"
                                                checked={activeUnit.arrow}
                                                onChange={(e) => setUnits(units.map(u => u.id === activeUnit.id ? { ...u, arrow: e.target.checked } : u))}
                                            /> 矢印 (Arrow)
                                        </label>
                                    </>
                                )}
                            </div>
                        )}

                        {/* Text Label Unit */}
                        {activeUnit.type === 'label' && (
                            <div>
                                <h4 style={{ margin: '5px 0' }}>テキスト設定</h4>
                                <div style={{ marginBottom: '10px' }}>
                                    <label>テキスト:</label>
                                    <textarea
                                        value={activeUnit.text || ''}
                                        onChange={(e) => setUnits(units.map(u => u.id === activeUnit.id ? { ...u, text: e.target.value } : u))}
                                        disabled={isSpectator}
                                        style={{ width: '100%', height: '60px' }}
                                    />
                                </div>
                                <div style={{ marginBottom: '10px' }}>
                                    <label>サイズ: {activeUnit.fontSize || 16}px</label>
                                    <input
                                        type="range" min="10" max="100"
                                        value={activeUnit.fontSize || 16}
                                        onChange={(e) => setUnits(units.map(u => u.id === activeUnit.id ? { ...u, fontSize: parseInt(e.target.value) } : u))}
                                        disabled={isSpectator}
                                        style={{ width: '100%' }}
                                    />
                                </div>
                                <div style={{ marginBottom: '10px' }}>
                                    <label>色:</label>
                                    <input
                                        type="color"
                                        value={activeUnit.color || '#000000'}
                                        onChange={(e) => setUnits(units.map(u => u.id === activeUnit.id ? { ...u, color: e.target.value } : u))}
                                        disabled={isSpectator}
                                        style={{ display: 'block', marginTop: '5px' }}
                                    />
                                </div>
                                <div style={{ marginBottom: '10px' }}>
                                    <label>回転: {activeUnit.rotation || 0}°</label>
                                    <input
                                        type="range" min="0" max="360"
                                        value={activeUnit.rotation || 0}
                                        onChange={(e) => setUnits(units.map(u => u.id === activeUnit.id ? { ...u, rotation: parseInt(e.target.value) } : u))}
                                        disabled={isSpectator}
                                        style={{ width: '100%' }}
                                    />
                                </div>
                            </div>
                        )}

                        {/* Shape Unit */}
                        {activeUnit.type === 'shape' && (
                            <div>
                                <h4 style={{ margin: '5px 0' }}>図形設定</h4>
                                <div style={{ marginBottom: '10px' }}>
                                    <label>種類: {activeUnit.shapeType}</label>
                                </div>
                                <div style={{ marginBottom: '10px' }}>
                                    <label>幅: {activeUnit.width || 100}px</label>
                                    <input
                                        type="range" min="10" max="500"
                                        value={activeUnit.width || 100}
                                        onChange={(e) => setUnits(units.map(u => u.id === activeUnit.id ? { ...u, width: parseInt(e.target.value) } : u))}
                                        disabled={isSpectator}
                                        style={{ width: '100%' }}
                                    />
                                </div>
                                <div style={{ marginBottom: '10px' }}>
                                    <label>高さ: {activeUnit.height || 100}px</label>
                                    <input
                                        type="range" min="10" max="500"
                                        value={activeUnit.height || 100}
                                        onChange={(e) => setUnits(units.map(u => u.id === activeUnit.id ? { ...u, height: parseInt(e.target.value) } : u))}
                                        disabled={isSpectator}
                                        style={{ width: '100%' }}
                                    />
                                </div>
                                <div style={{ marginBottom: '10px' }}>
                                    <label>回転: {activeUnit.rotation || 0}°</label>
                                    <input
                                        type="range" min="0" max="360"
                                        value={activeUnit.rotation || 0}
                                        onChange={(e) => setUnits(units.map(u => u.id === activeUnit.id ? { ...u, rotation: parseInt(e.target.value) } : u))}
                                        disabled={isSpectator}
                                        style={{ width: '100%' }}
                                    />
                                </div>
                                <div style={{ marginBottom: '10px' }}>
                                    <label>色:</label>
                                    <input
                                        type="color"
                                        value={activeUnit.color || '#aaaaaa'}
                                        onChange={(e) => setUnits(units.map(u => u.id === activeUnit.id ? { ...u, color: e.target.value } : u))}
                                        disabled={isSpectator}
                                        style={{ display: 'block', marginTop: '5px' }}
                                    />
                                </div>
                                <div style={{ marginBottom: '10px' }}>
                                    <label>透明度: {Math.round((activeUnit.opacity || 0.8) * 100)}%</label>
                                    <input
                                        type="range" min="0" max="100"
                                        value={(activeUnit.opacity || 0.8) * 100}
                                        onChange={(e) => setUnits(units.map(u => u.id === activeUnit.id ? { ...u, opacity: parseInt(e.target.value) / 100 } : u))}
                                        disabled={isSpectator}
                                        style={{ width: '100%' }}
                                    />
                                </div>
                            </div>
                        )}

                        {!isSpectator && (
                            <button className="btn" style={{ marginTop: '20px', background: 'red', color: 'white' }} onClick={() => {
                                setUnits(units.filter(u => u.id !== activeUnit.id));
                                setSelectedUnitId(null);
                            }}>削除</button>
                        )}
                    </div>
                ) : (
                    <div style={{ color: '#666' }}>要素を選択してください</div>
                )}
            </div>

            {/* Main Area */}
            <div className="main-area">
                <div className="toolbar">
                    <div className="menu-group">
                        {!isSpectator && (
                            <>
                                <label className="btn">📂 ZIPを開く<input type="file" hidden onChange={onFileUpload} /></label>
                                <button className="btn" onClick={onSaveZip}>💾 ZIP保存</button>
                            </>
                        )}
                        <button className="btn" onClick={() => setShowDownloadModal(true)}>📄 戦力DL</button>
                        {!isSpectator && <label className="btn">🗺️ マップ背景<input type="file" hidden accept="image/*" onChange={onFileUpload} /></label>}
                        <button className="btn" onClick={onOpenSettings}>⚙ 設定</button>
                        <button className="btn" onClick={onOpenShipList}>📋 艦艇一覧</button>
                        <button className="btn" onClick={() => setShowShareModal(true)}>🔗 共有</button>
                    </div>
                    {/* Tabs logic can be simpler or same as before */}
                    <div className="separator">|</div>
                    {!isSpectator && (
                        <>
                            <button className="btn" onClick={() => handleAddUnit('fleet')}>📍 部隊ピン</button>
                            <button className="btn" onClick={() => handleAddUnit('label')}>T テキスト</button>
                            <div style={{ position: 'relative', display: 'inline-block' }}>
                                <button className="btn" onClick={() => setShowShapeMenu(!showShapeMenu)}>🔷 図形 ▼</button>
                                {showShapeMenu && (
                                    <div style={{
                                        position: 'absolute', top: '100%', left: 0,
                                        background: 'white', border: '1px solid #ccc',
                                        zIndex: 1000, display: 'flex', flexDirection: 'column',
                                        minWidth: '100px'
                                    }}>
                                        <div className="menu-item" onClick={() => { handleAddUnit('circle'); setShowShapeMenu(false); }}>〇 円</div>
                                        <div className="menu-item" onClick={() => { handleAddUnit('rect'); setShowShapeMenu(false); }}>□ 四角</div>
                                        <div className="menu-item" onClick={() => { handleAddUnit('triangle'); setShowShapeMenu(false); }}>△ 三角</div>
                                        <div className="menu-item" onClick={() => { handleAddUnit('convex'); setShowShapeMenu(false); }}>凸 凸型</div>
                                    </div>
                                )}
                            </div>
                            <button className="btn" onClick={() => handleAddUnit('line')}>🖊️ ライン</button>
                        </>
                    )}
                </div>

                {/* Map Container */}
                <div
                    className="map-container"
                    onContextMenu={handleMapContextMenu}
                    onWheel={handleWheel}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onClick={(e) => {
                        if (!isDraggingMap) setSelectedUnitId(null);
                        closeContextMenu();
                        setShowShapeMenu(false);
                    }}
                    style={{
                        position: 'relative', width: '100%', height: '100%',
                        overflow: 'hidden', backgroundColor: '#e0e0e0', cursor: isDraggingMap ? 'grabbing' : 'default'
                    }}
                >
                    {/* Transformed Layer */}
                    <div style={{
                        transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                        transformOrigin: '0 0',
                        width: '100%', height: '100%',
                        position: 'absolute'
                    }}>
                        {mapImage && (
                            <img
                                ref={mapImgRef}
                                src={mapImage}
                                alt="Map"
                                style={{
                                    position: 'absolute', top: 0, left: 0,
                                    zIndex: 0, // Background at back
                                    pointerEvents: 'none',
                                    userSelect: 'none',
                                    WebkitUserDrag: 'none'
                                    // user wants to align coords to pixels? 
                                    // Default img displays at natural size if no width/height constraint is strict on the img tag itself inside absolute
                                    // We let it follow its natural size so coordinates map 1:1 to pixels
                                }}
                            />
                        )}

                        {/* Map Lines SVG Layer */}
                        <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none', zIndex: 50 }}>
                            <defs>
                                {['#FF0000', '#0000FF', '#008000', '#FFA500', '#800080', '#008080', '#000000', '#FF1493'].map(c => (
                                    <marker key={c} id={`arrow-${c.replace('#', '')}`} markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                                        <polygon points="0 0, 10 3.5, 0 7" fill={c} />
                                    </marker>
                                ))}
                            </defs>
                            {units.filter(u => u.type === 'line').map(line => {
                                let d = '';
                                if (line.points && line.points.length >= 2) {
                                    if (line.points.length === 2) {
                                        d = `M ${line.points[0].x} ${line.points[0].y} L ${line.points[1].x} ${line.points[1].y}`;
                                    } else if (line.points.length === 3) {
                                        d = `M ${line.points[0].x} ${line.points[0].y} Q ${line.points[1].x} ${line.points[1].y} ${line.points[2].x} ${line.points[2].y}`;
                                    }
                                }
                                const isSelected = selectedUnitId === line.id;
                                const color = line.color || '#FF0000';
                                const markerId = line.arrow ? `url(#arrow-${color.replace('#', '')})` : 'none';

                                return (
                                    <g key={line.id} onClick={(e) => { e.stopPropagation(); setSelectedUnitId(line.id); }} style={{ pointerEvents: 'stroke', cursor: 'pointer' }}>
                                        <path d={d} stroke="transparent" strokeWidth="20" fill="none" />
                                        <path d={d} stroke={color} strokeWidth={line.width || 3} fill="none"
                                            markerEnd={markerId}
                                            style={{ filter: isSelected ? 'drop-shadow(0 0 5px orange)' : 'none' }} />
                                    </g>
                                );
                            })}
                        </svg>

                        {/* Line Handles */}
                        {units.filter(u => u.type === 'line' && u.id === selectedUnitId && !isSpectator).map(line => (
                            line.points && line.points.map((p, idx) => (
                                <Draggable
                                    key={`${line.id}-${idx}`}
                                    position={{ x: p.x, y: p.y }}
                                    scale={scale}
                                    onDrag={(e, data) => {
                                        const newPoints = [...line.points];
                                        newPoints[idx] = { x: data.x, y: data.y };
                                        setUnits(units.map(u => u.id === line.id ? { ...u, points: newPoints } : u));
                                    }}
                                    onStop={(e, data) => {
                                        const newPoints = [...line.points];
                                        newPoints[idx] = { x: data.x, y: data.y };
                                        setUnits(units.map(u => u.id === line.id ? { ...u, points: newPoints } : u));
                                    }}
                                >
                                    <div style={{
                                        position: 'absolute', width: '8px', height: '8px', background: line.color, border: '2px solid white',
                                        borderRadius: '50%', marginLeft: '-6px', marginTop: '-6px', cursor: 'grab', zIndex: 200,
                                        boxShadow: '0 0 2px rgba(0,0,0,0.5)'
                                    }}>
                                    </div>
                                </Draggable>
                            ))
                        ))}

                        {units.map(unit => (
                            <Draggable
                                key={unit.id}
                                position={{ x: unit.x, y: unit.y }}
                                scale={scale} // adjust draggable movement by scale
                                disabled={isSpectator}
                                onStop={(e, data) => {
                                    const newX = data.x;
                                    const newY = data.y;
                                    setUnits(units.map(u => u.id === unit.id ? { ...u, x: newX, y: newY } : u));

                                    // Collision Check for Merge (only for fleets)
                                    if ((!unit.type || unit.type === 'fleet') && !isSpectator) {
                                        const target = units.find(u => {
                                            if (u.id === unit.id) return false;
                                            if (u.type && u.type !== 'fleet') return false;
                                            const dist = Math.hypot(u.x - newX, u.y - newY);
                                            return dist < 40; // Threshold
                                        });
                                        if (target) {
                                            setMergeCandidate({ source: { ...unit, x: newX, y: newY }, target });
                                        }
                                    }
                                }}
                            >
                                <div
                                    className="unit-element"
                                    onTouchStart={() => {
                                        if (activeUnit && activeUnit.type === 'line') return;
                                        setSelectedUnitId(unit.id);
                                    }}
                                    onContextMenu={(e) => handleContextMenu(e, unit.id)}
                                    onClick={(e) => { e.stopPropagation(); setSelectedUnitId(unit.id); }}
                                    onMouseEnter={() => { if (!selectedUnitId) setHoveredUnitId(unit.id); }}
                                    onMouseLeave={() => setHoveredUnitId(null)}
                                    style={{
                                        position: 'absolute', cursor: 'grab',
                                        zIndex: 100, // Foreground
                                        pointerEvents: (activeUnit && activeUnit.type === 'line' && activeUnit.id !== unit.id) ? 'none' : 'auto',
                                        opacity: (activeUnit && activeUnit.type === 'line' && activeUnit.id !== unit.id) ? 0.5 : 1 // Visual cue
                                    }}
                                >
                                    {(!unit.type || unit.type === 'fleet') && (
                                        <div
                                            style={{
                                                color: unit.color || 'red',
                                                fontWeight: 'bold',
                                                textShadow: (selectedUnitId === unit.id || (!selectedUnitId && hoveredUnitId === unit.id)) ? '2px 2px 2px rgba(0,0,0,0.8), 0 0 5px white' : '0 0 3px white',
                                                whiteSpace: 'nowrap'
                                            }}
                                        >
                                            ▼
                                            <span className="unit-label" style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'top', textAlign: 'left', whiteSpace: 'normal' }}>
                                                {unit.displayName ?
                                                    unit.displayName.split(/\u3000\u3000/).map((str, i) => <div key={i}>{str}</div>) :
                                                    ((unit.fleets || []).map(f => f.code).join(' + ') || 'No Name')
                                                }
                                            </span>

                                            {/* Hover List */}
                                            {(selectedUnitId === unit.id || (!selectedUnitId && hoveredUnitId === unit.id)) && (
                                                <div style={{
                                                    position: 'absolute',
                                                    top: '100%',
                                                    left: '1.2em',
                                                    transform: 'none',
                                                    background: 'rgba(255, 255, 255, 0.9)',
                                                    border: '1px solid #ccc',
                                                    padding: '4px',
                                                    borderRadius: '4px',
                                                    fontSize: '0.8em',
                                                    color: 'black',
                                                    zIndex: 101,
                                                    pointerEvents: 'none',
                                                    marginTop: '2px',
                                                    display: 'grid',
                                                    gridTemplateColumns: 'auto 1fr',
                                                    alignItems: 'center',
                                                    gap: '0 4px',
                                                    textAlign: 'left',
                                                    textShadow: 'none',
                                                    width: 'max-content'
                                                }}>

                                                    {(unit.fleets || []).map((f, idx) => {
                                                        const match = f.code.match(/^(\d{3,4})([A-Z]+)Sq\.$/);
                                                        const typeCode = match ? match[2] : null;
                                                        return (
                                                            <React.Fragment key={idx}>
                                                                <div style={{ display: 'flex', justifyContent: 'center', minWidth: '1.2em' }}>
                                                                    {typeCode && (
                                                                        <img
                                                                            src={`/assets/ships/${typeCode}.png`}
                                                                            alt=""
                                                                            style={{ height: '1.2em', verticalAlign: 'middle' }}
                                                                            onError={(e) => e.target.style.display = 'none'}
                                                                        />
                                                                    )}
                                                                </div>
                                                                <div style={{ whiteSpace: 'nowrap' }}>
                                                                    {f.code}
                                                                </div>
                                                            </React.Fragment>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {unit.type === 'label' && (
                                        <div style={{
                                            color: unit.color || 'black',
                                            fontSize: unit.fontSize || 16,
                                            border: selectedUnitId === unit.id ? '1px dashed #666' : 'none',
                                            padding: '2px',
                                            whiteSpace: 'pre',
                                            transform: `rotate(${unit.rotation || 0}deg)`,
                                            transformOrigin: 'center'
                                        }}>
                                            {unit.text || 'Label'}
                                        </div>
                                    )}
                                    {unit.type === 'image' && (
                                        <img src={unit.src} alt="added" style={{ width: unit.width || 100, border: selectedUnitId === unit.id ? '2px solid blue' : 'none' }} />
                                    )}
                                    {unit.type === 'shape' && (
                                        <div style={{
                                            width: unit.width || 100,
                                            height: unit.height || 100,
                                            transform: `rotate(${unit.rotation || 0}deg)`,
                                            transformOrigin: 'center',
                                            border: selectedUnitId === unit.id ? '2px dashed #333' : 'none'
                                        }}>
                                            <svg width="100%" height="100%" viewBox="0 0 100 100" style={{ overflow: 'visible' }} preserveAspectRatio="none">
                                                {unit.shapeType === 'circle' && (
                                                    <circle cx="50" cy="50" r="48" fill={unit.color || '#aaaaaa'} fillOpacity={unit.opacity ?? 0.8} stroke="black" strokeWidth="2" />
                                                )}
                                                {unit.shapeType === 'rect' && (
                                                    <rect x="2" y="2" width="96" height="96" fill={unit.color || '#aaaaaa'} fillOpacity={unit.opacity ?? 0.8} stroke="black" strokeWidth="2" />
                                                )}
                                                {unit.shapeType === 'triangle' && (
                                                    <polygon points="50,2 98,98 2,98" fill={unit.color || '#aaaaaa'} fillOpacity={unit.opacity ?? 0.8} stroke="black" strokeWidth="2" />
                                                )}
                                                {unit.shapeType === 'convex' && (
                                                    <polygon points="25,2 75,2 75,50 98,50 98,98 2,98 2,50 25,50" fill={unit.color || '#aaaaaa'} fillOpacity={unit.opacity ?? 0.8} stroke="black" strokeWidth="2" />
                                                )}
                                            </svg>
                                        </div>
                                    )}
                                </div>
                            </Draggable>
                        ))}
                    </div>
                </div>
            </div>

            {/* Context Menu */}
            {
                contextMenu.visible && (
                    <div className="context-menu" style={{
                        position: 'fixed', top: contextMenu.y, left: contextMenu.x,
                        background: 'white', border: '1px solid #ccc',
                        boxShadow: '2px 2px 5px rgba(0,0,0,0.2)', zIndex: 1000
                    }}>
                        {!contextMenu.isBackground ? (
                            <>
                                {units.find(u => u.id === contextMenu.unitId)?.type !== 'label' && (
                                    <div className="menu-item" onClick={() => handleMenuAction('edit')}>編集</div>
                                )}
                                {(!activeUnit || activeUnit.type === 'fleet') && (
                                    <div className="menu-item" onClick={() => handleMenuAction('add_fleet')}>部隊を追加</div>
                                )}
                                {(!activeUnit || activeUnit.type === 'fleet') && (
                                    <div className="menu-item" onClick={() => handleMenuAction('split')}>部隊分割</div>
                                )}
                                <div className="menu-item" onClick={() => handleMenuAction('cut')}>切り取り</div>
                                <div className="menu-item" onClick={() => handleMenuAction('copy')}>コピー</div>
                                <hr style={{ margin: '2px 0' }} />
                                <div className="menu-item" onClick={() => handleMenuAction('delete')} style={{ color: 'red' }}>削除</div>
                            </>
                        ) : (
                            <div className={`menu-item ${!clipboard ? 'disabled' : ''}`} onClick={() => handleMenuAction('paste')}>
                                貼り付け {clipboard ? `(${clipboard.type})` : ''}
                            </div>
                        )}
                    </div>
                )
            }

            <style>{`
                /* Some shared styles */
                .menu-item { padding: 8px 12px; cursor: pointer; }
                .menu-item:hover { background: #f0f0f0; }
                .menu-item.disabled { color: #ccc; pointer-events: none; }
            `}</style>
            {/* Download Modal */}
            {
                showDownloadModal && (
                    <div style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        background: 'rgba(0,0,0,0.5)', zIndex: 1000,
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                        <div style={{ background: 'white', padding: '20px', borderRadius: '8px', minWidth: '300px' }}>
                            <h3 style={{ marginTop: 0 }}>戦力データ出力</h3>
                            <p>出力形式を選択してください。</p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '20px' }}>
                                <button className="btn" onClick={handleDownloadTXT}>テキスト形式 (.txt) - 階層構造</button>
                                <button className="btn" onClick={handleDownloadCSV}>CSV形式 (.csv) - 詳細データ</button>
                                <button className="btn" onClick={() => setShowDownloadModal(false)} style={{ marginTop: '10px' }}>キャンセル</button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Share Modal */}
            {
                showShareModal && (
                    <div style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        background: 'rgba(0,0,0,0.5)', zIndex: 1000,
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                        <div style={{ background: 'white', padding: '20px', borderRadius: '8px', minWidth: '300px' }}>
                            <h3 style={{ marginTop: 0 }}>共有リンク発行</h3>
                            <p>発行するリンクのタイプを選択してください。</p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '20px' }}>
                                {!isSpectator && (
                                    <button className="btn" onClick={() => copyLink('edit')}>編集権限あり (共有用)</button>
                                )}
                                <button className="btn" onClick={() => copyLink('spectator')}>閲覧専用 (観戦用)</button>
                                <button className="btn" onClick={() => setShowShareModal(false)} style={{ marginTop: '10px' }}>キャンセル</button>
                            </div>
                        </div>
                    </div>
                )
            }
            {/* Merge Confirmation Modal */}
            {
                mergeCandidate && (
                    <div style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        background: 'rgba(0,0,0,0.5)', zIndex: 1100,
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                        <div style={{ background: 'white', padding: '20px', borderRadius: '8px', minWidth: '350px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
                            <h3 style={{ marginTop: 0, color: '#333' }}>艦隊の統合</h3>
                            <p style={{ margin: '15px 0' }}>
                                以下の艦隊を統合しますか？
                            </p>
                            <div style={{ background: '#f5f5f5', padding: '10px', borderRadius: '4px', marginBottom: '10px' }}>
                                <div style={{ marginBottom: '5px' }}><strong>統合元 (消滅):</strong> {mergeCandidate.source.displayName || '名称未設定'}</div>
                                <div style={{ textAlign: 'center', color: '#666' }}>⬇</div>
                                <div style={{ marginTop: '5px' }}><strong>統合先 (維持):</strong> {mergeCandidate.target.displayName || '名称未設定'}</div>
                            </div>
                            <p style={{ fontSize: '0.9em', color: 'red' }}>※統合元の艦隊ピンは削除されます。</p>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                                <button className="btn" onClick={() => setMergeCandidate(null)}>キャンセル</button>
                                <button className="btn" onClick={() => {
                                    const { source, target } = mergeCandidate;
                                    // Merge Logic
                                    const newFleets = [...(target.fleets || []), ...(source.fleets || [])];
                                    const updatedTarget = { ...target, fleets: newFleets };

                                    // Remove source, Update target
                                    setUnits(units.filter(u => u.id !== source.id).map(u => u.id === target.id ? updatedTarget : u));
                                    setMergeCandidate(null);
                                }} style={{ background: '#007bff', color: 'white' }}>統合する</button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default MainScreen;