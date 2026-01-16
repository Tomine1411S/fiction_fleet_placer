import React, { useState, useRef, useEffect } from 'react';
import Draggable from 'react-draggable';
import { saveAs } from 'file-saver';
import { fileToBase64 } from '../utils/fileUtils';

const MainScreen = ({
    layers = [], setLayers, activeLayerId, setActiveLayerId, // New Props
    units = [], setUnits, mapImage: propMapImage, // Legacy/Compat props (units is activeLayer.units)
    onSwitchScreen, onOpenSettings, onOpenShipList, onFileUpload, onSaveZip, onDownloadReport, selectedUnitId, setSelectedUnitId, fleetTypes, isSpectator, sessionId, spectatorShareId, onOpenSplitScreen,
    appSettings // New Prop
}) => {
    // Computed: Active Layer
    const activeLayer = layers.find(l => l.id === activeLayerId) || layers[0] || { units: [], id: 1 };

    // Map Image Logic
    // We render ALL layer images that are visible, stacked by z-index.
    // This circumvents browser issues with rapid src swapping and provides instant toggling.

    const [hoveredUnitId, setHoveredUnitId] = useState(null);
    const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, unitId: null, isBackground: false });
    const [clipboard, setClipboard] = useState(null);
    const [tab, setTab] = useState('file');

    const [showLayerPanel, setShowLayerPanel] = useState(false);
    const [showImageUploadModal, setShowImageUploadModal] = useState(false);
    const [uploadImageFile, setUploadImageFile] = useState(null);
    const [uploadTargetLayerId, setUploadTargetLayerId] = useState(activeLayerId);

    // Zoom/Pan State
    const [scale, setScale] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDraggingMap, setIsDraggingMap] = useState(false);
    const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
    const [showDownloadModal, setShowDownloadModal] = useState(false);
    const [showShareModal, setShowShareModal] = useState(false);
    const [mergeCandidate, setMergeCandidate] = useState(null);
    const [showShapeMenu, setShowShapeMenu] = useState(false);

    // Layer Drag State
    const [draggingLayerIdx, setDraggingLayerIdx] = useState(null);
    const [placeholderLayerIdx, setPlaceholderLayerIdx] = useState(null);
    const layerListRef = useRef(null);

    // Layer Renaming
    const [editingLayerId, setEditingLayerId] = useState(null);

    // Layer Image Drag State
    const [isDraggingLayerImage, setIsDraggingLayerImage] = useState(false); // Mode
    const [isImageDragActive, setIsImageDragActive] = useState(false); // Action

    const updateLayerImage = (layerId, updates) => {
        setLayers(layers.map(l => l.id === layerId ? { ...l, ...updates } : l));
    };

    const handleRenameLayer = (layerId, newName) => {
        setLayers(layers.map(l => l.id === layerId ? { ...l, name: newName } : l));
        setEditingLayerId(null);
    };


    // --- Layer Operations ---
    const handleAddLayer = () => {
        if (isSpectator) return;
        if (layers.length >= 20) {
            alert("これ以上レイヤーを追加できません (最大20)");
            return;
        }
        const newId = Math.max(...layers.map(l => l.id)) + 1;
        setLayers([...layers, {
            id: newId,
            name: `Layer ${newId}`,
            visible: true,
            units: [],
            mapImage: null,
            mapImageX: 0,
            mapImageY: 0,
            mapImageScale: 1,
            mapImageRotation: 0,
            mapImageOpacity: 1
        }]);
        setActiveLayerId(newId);
    };

    const handleToggleVisibility = (id) => {
        // Toggle visibility. Note: Requirement says "Inactive layers... hidden in map". 
        // But also "Display switching". We allow toggling.
        // If Active Layer is toggled off, should it be hidden? Usually Active implies Visible.
        // We will force Active to be Visible when selected?
        setLayers(layers.map(l => l.id === id ? { ...l, visible: !l.visible } : l));
    };

    const handleDeleteLayer = (id) => {
        if (isSpectator) return;
        if (layers.length <= 1) return;
        if (!window.confirm(`Layer ${id} を削除しますか？`)) return;

        const newLayers = layers.filter(l => l.id !== id);
        setLayers(newLayers);
        if (activeLayerId === id) {
            setActiveLayerId(newLayers[newLayers.length - 1].id);
        }
    };

    const handleLayerDragStart = (e, index) => {
        if (isSpectator) return;
        setDraggingLayerIdx(index);
        setPlaceholderLayerIdx(index);
    };

    const handleLayerDrag = (e, data) => {
        // Simple Y-axis list drag logic
        const ITEM_HEIGHT = 50; // Approximate height of a layer item
        const moveCount = Math.round(data.y / ITEM_HEIGHT);
        let newIdx = draggingLayerIdx + moveCount;
        newIdx = Math.max(0, Math.min(newIdx, layers.length - 1));

        if (newIdx !== placeholderLayerIdx) {
            setPlaceholderLayerIdx(newIdx);
        }
    };

    const handleLayerDragStop = (e, data) => {
        if (draggingLayerIdx === null) return;

        if (draggingLayerIdx !== placeholderLayerIdx) {
            const newLayers = [...layers];
            const [movedLayer] = newLayers.splice(draggingLayerIdx, 1);
            newLayers.splice(placeholderLayerIdx, 0, movedLayer);
            setLayers(newLayers);
        }
        setDraggingLayerIdx(null);
        setPlaceholderLayerIdx(null);
    };

    const handleDuplicateLayer = (layerId) => {
        if (isSpectator) return;
        if (layers.length >= 20) {
            alert("これ以上レイヤーを追加できません (最大20)");
            return;
        }

        const targetLayer = layers.find(l => l.id === layerId);
        if (!targetLayer) return;

        const newLayerId = Math.max(...layers.map(l => l.id)) + 1;

        // Deep clone units and regenerate IDs to avoid conflicts
        const newUnits = (targetLayer.units || []).map((u, i) => {
            // Basic clone
            const unitClone = JSON.parse(JSON.stringify(u));
            // Assign new ID. ensure uniqueness. 
            // Using Date.now() might collide if fast loop, so add index offset/random
            unitClone.id = Date.now() + i + Math.floor(Math.random() * 1000);
            return unitClone;
        });

        const newLayer = {
            ...targetLayer,
            id: newLayerId,
            name: `${targetLayer.name} (Copy)`,
            units: newUnits,
            visible: true,
            // Copy image props
            mapImageX: targetLayer.mapImageX || 0,
            mapImageY: targetLayer.mapImageY || 0,
            mapImageScale: targetLayer.mapImageScale || 1,
            mapImageRotation: targetLayer.mapImageRotation || 0,
            mapImageOpacity: targetLayer.mapImageOpacity ?? 1
            // mapImage/mapImageBlob are copied. 
            // Note: If mapImage is a Blob URL, it might be valid but double check lifecycle. 
            // For simple usage, copying the string URL is fine so long as blob exists.
        };

        const newLayers = [...layers, newLayer];
        setLayers(newLayers);
        setActiveLayerId(newLayerId);
    };

    const handleImageDelete = (layerId) => {
        if (isSpectator) return;
        if (!window.confirm("このレイヤーの画像を削除しますか？")) return;
        setLayers(layers.map(l => l.id === layerId ? { ...l, mapImage: null, mapImageBlob: null } : l));
    };

    const handleImageUploadConfirm = async () => {
        if (uploadImageFile && uploadTargetLayerId) {
            try {
                const base64 = await fileToBase64(uploadImageFile);
                setLayers(layers.map(l => l.id === uploadTargetLayerId ? {
                    ...l,
                    mapImage: base64,
                    mapImageBlob: uploadImageFile,
                    // Reset Transforms
                    mapImageX: 0, mapImageY: 0, mapImageScale: 1, mapImageRotation: 0, mapImageOpacity: 1
                } : l));
                setShowImageUploadModal(false);
                setUploadImageFile(null);
            } catch (e) {
                console.error("Failed to convert image", e);
                alert("画像の処理に失敗しました");
            }
        }
    };

    // --- Download Handlers ---
    const handleDownloadTXT = () => {
        try {
            let text = "";
            // Flatten relevant layers (Visible only? or All? Plan says "Ship List counts displayed". Download should likely match.)
            const targetLayers = layers.filter(l => l.visible);

            targetLayers.forEach(layer => {
                text += `[${layer.name}]\n`;
                const layerUnits = layer.units || [];
                layerUnits.forEach(unit => {
                    if (unit.type === 'fleet' || !unit.type) {
                        // Pin Name
                        const pinName = unit.displayName || (unit.fleets || []).map(f => f.code).join(' + ') || 'No Name';
                        text += `・${pinName}\n`;
                        (unit.fleets || []).forEach(fleet => {
                            text += `　・${fleet.name || 'No Name'}\n`;
                            (fleet.ships || []).forEach((ship) => {
                                const shipId = `${ship.type || ''}-${ship.classCode || ''}${ship.number || ''}`;
                                text += `　　・${shipId} ${ship.name || 'No Name'}\n`;
                            });
                        });
                    }
                });
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
            let csv = "layer,no,pin-name,fleet-name,fleet-ID,fleet-type,ship-num-in-fleet,ship-name,ship-ID\n";
            let globalNo = 1;
            const targetLayers = layers.filter(l => l.visible);

            targetLayers.forEach(layer => {
                const layerUnits = layer.units || [];
                layerUnits.forEach(unit => {
                    if (unit.type === 'fleet' || !unit.type) {
                        const pinName = unit.displayName || (unit.fleets || []).map(f => f.code).join(' + ') || 'No Name';

                        (unit.fleets || []).forEach(fleet => {
                            let fType = "";
                            if (fleet.code) {
                                const match = fleet.code.match(/(\d+)([A-Z]+)Sq\./);
                                if (match) fType = match[2];
                            }

                            (fleet.ships || []).forEach((ship, idx) => {
                                const shipId = `${ship.type || ''}-${ship.classCode || ''}${ship.number || ''}`;
                                const line = [
                                    layer.name,
                                    globalNo++,
                                    pinName,
                                    fleet.name || '',
                                    fleet.code || '',
                                    fType,
                                    idx + 1,
                                    ship.name || '',
                                    shipId
                                ].map(v => `"${v}"`).join(",");
                                csv += line + "\n";
                            });
                        });
                    }
                });
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

    // Search Logic (Searching all layers)
    const searchResults = React.useMemo(() => {
        if (!searchQuery.trim()) return [];
        const lowerQuery = searchQuery.toLowerCase();
        const results = [];

        layers.forEach(layer => {
            layer.units.forEach(u => {
                let match = false;
                if (u.type && u.type !== 'fleet' && u.type !== 'label') return;
                if (u.type === 'label' && u.text && u.text.toLowerCase().includes(lowerQuery)) match = true;
                if (u.displayName && u.displayName.toLowerCase().includes(lowerQuery)) match = true;
                if (u.fleets) {
                    if (u.fleets.some(f => {
                        if (f.code && f.code.toLowerCase().includes(lowerQuery)) return true;
                        if (f.name && f.name.toLowerCase().includes(lowerQuery)) return true;
                        if (f.ships && f.ships.some(s => {
                            if (s.name && s.name.toLowerCase().includes(lowerQuery)) return true;
                            if (s.number && s.number.includes(lowerQuery)) return true;
                            const fullStr = `${s.type}-${s.classCode}${s.number}`.toLowerCase();
                            if (fullStr.includes(lowerQuery)) return true;
                            return false;
                        })) return true;
                        return false;
                    })) match = true;
                }

                if (match) {
                    results.push({ ...u, layerId: layer.id, layerName: layer.name });
                }
            });
        });
        return results;
    }, [layers, searchQuery]);

    const handleSearchResultClick = (result) => {
        // Switch to that layer
        setActiveLayerId(result.layerId);
        // Ensure visible?
        const layer = layers.find(l => l.id === result.layerId);
        if (layer && !layer.visible) {
            setLayers(layers.map(l => l.id === result.layerId ? { ...l, visible: true } : l));
        }

        setSelectedUnitId(result.id);
        setPosition({
            x: 400 - result.x * scale,
            y: 300 - result.y * scale
        });
    };

    // --- Unit Update Helpers (Cross-Layer) ---
    const updateUnit = (unitId, patchOrFn) => {
        setLayers(prevLayers => prevLayers.map(layer => {
            // Optimization: check if unit exists in this layer (simple check)
            // or just map.
            const unitExists = layer.units.some(u => u.id === unitId);
            if (!unitExists) return layer;

            const newUnits = layer.units.map(u => {
                if (u.id !== unitId) return u;
                // Apply update
                return typeof patchOrFn === 'function' ? patchOrFn(u) : { ...u, ...patchOrFn };
            });
            return { ...layer, units: newUnits };
        }));
    };

    const deleteUnit = (unitId) => {
        setLayers(prevLayers => prevLayers.map(layer => ({
            ...layer,
            units: layer.units.filter(u => u.id !== unitId)
        })));
        if (selectedUnitId === unitId) setSelectedUnitId(null);
    };

    // Refs for map dimensions
    const mapImgRef = useRef(null);

    // activeUnit logic: Search ALL visible layers (or all layers?) 
    // Requirement: "Non-active but currently selected layer... can edit fleet info"
    // So we should search all layers for the selected ID.
    const allVisibleUnits = layers.filter(l => l.visible).flatMap(l => l.units);
    const activeUnit = allVisibleUnits.find(u => u.id === (selectedUnitId || hoveredUnitId));

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
        if (isDraggingLayerImage && activeLayer.mapImage) {
            // Dragging Layer Image
            e.preventDefault();
            setIsImageDragActive(true);
            setLastMousePos({ x: e.clientX, y: e.clientY });
            // Do NOT set isDraggingMap
        } else if (e.button === 1 || (e.button === 0 && e.nativeEvent.getModifierState('Space'))) { // Middle click or Space+Left
            e.preventDefault();
            setIsDraggingMap(true);
            setLastMousePos({ x: e.clientX, y: e.clientY });
        }
    };

    const handleMouseMove = (e) => {
        if (isDraggingLayerImage && isImageDragActive && activeLayer.mapImage) {
            const dx = (e.clientX - lastMousePos.x) / scale; // Adjust for map zoom
            const dy = (e.clientY - lastMousePos.y) / scale;

            // Adjust X/Y based on rotation? Complex.
            // Simple visual move: just add to x/y.
            updateLayerImage(activeLayerId, {
                mapImageX: (activeLayer.mapImageX || 0) + dx,
                mapImageY: (activeLayer.mapImageY || 0) + dy
            });
            setLastMousePos({ x: e.clientX, y: e.clientY });
        } else if (isDraggingMap) {
            const dx = e.clientX - lastMousePos.x;
            const dy = e.clientY - lastMousePos.y;
            setPosition({ x: position.x + dx, y: position.y + dy });
            setLastMousePos({ x: e.clientX, y: e.clientY });
        }
    };

    const handleMouseUp = () => {
        setIsDraggingMap(false);
        setIsImageDragActive(false);
    };

    // Automatically center/fit map on image load
    // Disabled to prevent jarring jumps when toggling layers
    /*
    useEffect(() => {
        if (mapImgRef.current && currentMapImage) {
            setPosition({ x: 0, y: 0 });
        }
    }, [currentMapImage]);
    */

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
        // Find target unit from ALL visible layers
        const targetUnit = allVisibleUnits.find(u => u.id === contextMenu.unitId);

        if (action === 'delete') {
            deleteUnit(contextMenu.unitId);
        }
        else if (action === 'copy' && targetUnit) {
            setClipboard({ ...targetUnit, id: Date.now() });
        }
        else if (action === 'cut' && targetUnit) {
            setClipboard({ ...targetUnit, id: Date.now() });
            deleteUnit(contextMenu.unitId);
        }
        else if (action === 'edit' && targetUnit) {
            // Find layer of targetUnit
            const unitLayer = layers.find(l => l.units.some(u => u.id === targetUnit.id));
            if (unitLayer && unitLayer.id !== activeLayerId) {
                setActiveLayerId(unitLayer.id);
            }
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
            // Paste always goes to Active Layer
            setUnits([...units, newUnit]);
        }
        else if (action === 'add_fleet' && targetUnit) {
            // Add another fleet to this pin
            // Ensure targetUnit.fleets exists
            updateUnit(targetUnit.id, (u) => {
                const newFleets = u.fleets ? [...u.fleets] : [];
                newFleets.push({
                    id: Date.now(),
                    code: 'New',
                    name: '',
                    ships: [],
                    remarks: ''
                });
                return { ...u, fleets: newFleets };
            });

            // Ensure active layer is switched so EditScreen finds it
            const unitLayer = layers.find(l => l.units.some(u => u.id === targetUnit.id));
            if (unitLayer && unitLayer.id !== activeLayerId) {
                setActiveLayerId(unitLayer.id);
            }

            // Auto open edit?
            setSelectedUnitId(targetUnit.id);
            onSwitchScreen();
        }
        else if (action === 'split' && targetUnit) {
            // FIX: Ensure active layer is correct
            const unitLayer = layers.find(l => l.units.some(u => u.id === targetUnit.id));
            if (unitLayer && unitLayer.id !== activeLayerId) {
                setActiveLayerId(unitLayer.id);
            }
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

    const handleAddImageUpload = async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const base64 = await fileToBase64(file);
                const cx = (400 - position.x) / scale;
                const cy = (300 - position.y) / scale;
                const newUnit = { id: Date.now(), x: cx, y: cy, type: 'image', src: base64, width: 100 };
                setUnits([...units, newUnit]);
            } catch (err) {
                console.error("Failed to load image unit", err);
            }
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
                        {activeUnit.type === 'line' && (
                            <div>
                                <h4 style={{ margin: '5px 0' }}>ライン設定</h4>
                                <div style={{ marginBottom: '10px' }}>
                                    <label>色:</label>
                                    <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginTop: '5px' }}>
                                        {['#FF0000', '#0000FF', '#008000', '#FFA500', '#800080', '#008080', '#000000', '#FF1493'].map(c => (
                                            <div key={c}
                                                onClick={() => !isSpectator && updateUnit(activeUnit.id, { color: c })}
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
                                                    updateUnit(activeUnit.id, { points: newPoints });
                                                }}
                                            /> 曲線化 (Curve)
                                        </label>
                                        <label style={{ display: 'block' }}>
                                            <input type="checkbox"
                                                checked={activeUnit.arrow}
                                                onChange={(e) => updateUnit(activeUnit.id, { arrow: e.target.checked })}
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
                                        onChange={(e) => updateUnit(activeUnit.id, { text: e.target.value })}
                                        disabled={isSpectator}
                                        style={{ width: '100%', height: '60px' }}
                                    />
                                </div>
                                <div style={{ marginBottom: '10px' }}>
                                    <label>サイズ: {activeUnit.fontSize || 16}px</label>
                                    <input
                                        type="range" min="10" max="100"
                                        value={activeUnit.fontSize || 16}
                                        onChange={(e) => updateUnit(activeUnit.id, { fontSize: parseInt(e.target.value) })}
                                        disabled={isSpectator}
                                        style={{ width: '100%' }}
                                    />
                                </div>
                                <div style={{ marginBottom: '10px' }}>
                                    <label>色:</label>
                                    <input
                                        type="color"
                                        value={activeUnit.color || '#000000'}
                                        onChange={(e) => updateUnit(activeUnit.id, { color: e.target.value })}
                                        disabled={isSpectator}
                                        style={{ display: 'block', marginTop: '5px' }}
                                    />
                                </div>
                                <div style={{ marginBottom: '10px' }}>
                                    <label>回転: {activeUnit.rotation || 0}°</label>
                                    <input
                                        type="range" min="0" max="360"
                                        value={activeUnit.rotation || 0}
                                        onChange={(e) => updateUnit(activeUnit.id, { rotation: parseInt(e.target.value) })}
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
                                        onChange={(e) => updateUnit(activeUnit.id, { width: parseInt(e.target.value) })}
                                        disabled={isSpectator}
                                        style={{ width: '100%' }}
                                    />
                                </div>
                                <div style={{ marginBottom: '10px' }}>
                                    <label>高さ: {activeUnit.height || 100}px</label>
                                    <input
                                        type="range" min="10" max="500"
                                        value={activeUnit.height || 100}
                                        onChange={(e) => updateUnit(activeUnit.id, { height: parseInt(e.target.value) })}
                                        disabled={isSpectator}
                                        style={{ width: '100%' }}
                                    />
                                </div>
                                <div style={{ marginBottom: '10px' }}>
                                    <label>回転: {activeUnit.rotation || 0}°</label>
                                    <input
                                        type="range" min="0" max="360"
                                        value={activeUnit.rotation || 0}
                                        onChange={(e) => updateUnit(activeUnit.id, { rotation: parseInt(e.target.value) })}
                                        disabled={isSpectator}
                                        style={{ width: '100%' }}
                                    />
                                </div>
                                <div style={{ marginBottom: '10px' }}>
                                    <label>色:</label>
                                    <input
                                        type="color"
                                        value={activeUnit.color || '#aaaaaa'}
                                        onChange={(e) => updateUnit(activeUnit.id, { color: e.target.value })}
                                        disabled={isSpectator}
                                        style={{ display: 'block', marginTop: '5px' }}
                                    />
                                </div>
                                <div style={{ marginBottom: '10px' }}>
                                    <label>透明度: {Math.round((activeUnit.opacity || 0.8) * 100)}%</label>
                                    <input
                                        type="range" min="0" max="100"
                                        value={(activeUnit.opacity || 0.8) * 100}
                                        onChange={(e) => updateUnit(activeUnit.id, { opacity: parseInt(e.target.value) / 100 })}
                                        disabled={isSpectator}
                                        style={{ width: '100%' }}
                                    />
                                </div>
                            </div>
                        )}

                        {!isSpectator && (
                            <button className="btn" style={{ marginTop: '20px', background: 'red', color: 'white' }} onClick={() => {
                                deleteUnit(activeUnit.id);
                            }}>削除</button>
                        )}
                    </div>
                ) : (
                    <div style={{ color: '#666' }}>要素を選択してください</div>
                )}

                {/* Layer Image Controls (Shown when no unit selected but active layer has image) */}
                {(!activeUnit && activeLayer.mapImage) && (
                    <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #ddd' }}>
                        <h4 style={{ margin: '5px 0' }}>レイヤー画像設定</h4>
                        <div style={{ marginBottom: '10px' }}>
                            <label style={{
                                display: 'block', padding: '8px', background: isDraggingLayerImage ? '#cce5ff' : '#eee',
                                border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', textAlign: 'center'
                            }}>
                                <input
                                    type="checkbox"
                                    checked={isDraggingLayerImage}
                                    onChange={(e) => setIsDraggingLayerImage(e.target.checked)}
                                    style={{ display: 'none' }}
                                />
                                {isDraggingLayerImage ? '✋ 画像移動中 (OFFにする)' : '✋ 画像を移動 (ONにする)'}
                            </label>
                            <div style={{ fontSize: '0.8em', color: '#666', marginTop: '2px' }}>
                                ※ダブルクリックで終了
                            </div>
                        </div>

                        <div style={{ marginBottom: '10px' }}>
                            <label>サイズ (倍率): {Math.round((activeLayer.mapImageScale || 1) * 100)}%</label>
                            <input
                                type="range" min="0.1" max="5.0" step="0.05"
                                value={activeLayer.mapImageScale || 1}
                                onChange={(e) => updateLayerImage(activeLayer.id, { mapImageScale: parseFloat(e.target.value) })}
                                disabled={isSpectator}
                                style={{ width: '100%' }}
                            />
                        </div>

                        <div style={{ marginBottom: '10px' }}>
                            <label>回転: {activeLayer.mapImageRotation || 0}°</label>
                            <input
                                type="range" min="0" max="360"
                                value={activeLayer.mapImageRotation || 0}
                                onChange={(e) => updateLayerImage(activeLayer.id, { mapImageRotation: parseInt(e.target.value) })}
                                disabled={isSpectator}
                                style={{ width: '100%' }}
                            />
                        </div>

                        <div style={{ marginBottom: '10px' }}>
                            <label>不透明度: {Math.round((activeLayer.mapImageOpacity ?? 1) * 100)}%</label>
                            <input
                                type="range" min="0" max="1" step="0.05"
                                value={activeLayer.mapImageOpacity ?? 1}
                                onChange={(e) => updateLayerImage(activeLayer.id, { mapImageOpacity: parseFloat(e.target.value) })}
                                disabled={isSpectator}
                                style={{ width: '100%' }}
                            />
                        </div>

                        {!isSpectator && (
                            <button className="btn" style={{ width: '100%', marginTop: '5px' }} onClick={() => updateLayerImage(activeLayer.id, {
                                mapImageX: 0, mapImageY: 0, mapImageScale: 1, mapImageRotation: 0, mapImageOpacity: 1
                            })}>
                                リセット
                            </button>
                        )}
                    </div>
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
                        <button className="btn" onClick={() => setShowLayerPanel(!showLayerPanel)}>📑 レイヤー</button>
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
                    onDoubleClick={() => {
                        if (isDraggingLayerImage) setIsDraggingLayerImage(false);
                    }}
                    onClick={(e) => {
                        if (!isDraggingMap && !isDraggingLayerImage) setSelectedUnitId(null);
                        closeContextMenu();
                        setShowShapeMenu(false);
                    }}
                    style={{
                        position: 'relative', width: '100%', height: '100%',
                        overflow: 'hidden', backgroundColor: '#e0e0e0',
                        cursor: isDraggingMap ? 'grabbing' : (isDraggingLayerImage ? 'move' : 'default')
                    }}
                >
                    {/* Transformed Layer */}
                    <div style={{
                        transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                        transformOrigin: '0 0',
                        width: '100%', height: '100%',
                        position: 'absolute'
                    }}>
                        {/* Map Images Layer (Stacked) */}
                        {layers.map((layer, index) => {
                            if (!layer.mapImage) return null;
                            // Requirement: "Active layers... hidden in map" handled by display: none
                            // Stack order: index (same as layers array order). Last is top.
                            return (
                                <img
                                    key={`map-layer-${layer.id}`}
                                    src={layer.mapImage}
                                    alt={`Map ${layer.name}`}
                                    style={{
                                        position: 'absolute', top: 0, left: 0,
                                        zIndex: index, // Stack based on layer order
                                        display: layer.visible ? 'block' : 'none', // Toggle visibility without unloading
                                        pointerEvents: 'none',
                                        userSelect: 'none',
                                        WebkitUserDrag: 'none',
                                        transformOrigin: '0 0',
                                        transform: `translate(${layer.mapImageX || 0}px, ${layer.mapImageY || 0}px) rotate(${layer.mapImageRotation || 0}deg) scale(${layer.mapImageScale || 1})`,
                                        opacity: layer.mapImageOpacity ?? 1
                                    }}
                                />
                            );
                        })}

                        {/* Map Lines SVG Layer */}
                        <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none', zIndex: 50 }}>
                            <defs>
                                {['#FF0000', '#0000FF', '#008000', '#FFA500', '#800080', '#008080', '#000000', '#FF1493'].map(c => (
                                    <marker key={c} id={`arrow-${c.replace('#', '')}`} markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                                        <polygon points="0 0, 10 3.5, 0 7" fill={c} />
                                    </marker>
                                ))}
                            </defs>
                            {layers.filter(l => l.visible).flatMap(layer =>
                                (layer.units || []).filter(u => u.type === 'line').map(line => ({ ...line, _layerId: layer.id }))
                            ).map(line => {
                                let d = '';
                                if (line.points && line.points.length >= 2) {
                                    if (line.points.length === 2) {
                                        d = `M ${line.points[0].x} ${line.points[0].y} L ${line.points[1].x} ${line.points[1].y}`;
                                    } else if (line.points.length === 3) {
                                        d = `M ${line.points[0].x} ${line.points[0].y} Q ${line.points[1].x} ${line.points[1].y} ${line.points[2].x} ${line.points[2].y}`;
                                    }
                                }
                                const isLayerActive = line._layerId === activeLayerId;
                                const isSelected = selectedUnitId === line.id && isLayerActive; // Only select if active
                                const color = line.color || '#FF0000';
                                const markerId = line.arrow ? `url(#arrow-${color.replace('#', '')})` : 'none';
                                const opacity = isLayerActive ? 1 : 0.4;

                                return (
                                    <g key={line.id}
                                        onClick={(e) => {
                                            if (!isLayerActive) return;
                                            e.stopPropagation(); setSelectedUnitId(line.id);
                                        }}
                                        style={{ pointerEvents: isLayerActive ? 'stroke' : 'none', cursor: isLayerActive ? 'pointer' : 'default', opacity }}>
                                        <path d={d} stroke="transparent" strokeWidth="20" fill="none" />
                                        <path d={d} stroke={color} strokeWidth={line.width || 3} fill="none"
                                            markerEnd={markerId}
                                            style={{ filter: isSelected ? 'drop-shadow(0 0 5px orange)' : 'none' }} />
                                    </g>
                                );
                            })}
                        </svg>

                        {/* Line Handles (Selected Line Only - Any Layer) */}
                        {(!isSpectator && activeUnit && activeUnit.type === 'line' && activeUnit.id === selectedUnitId) && activeUnit.points && activeUnit.points.map((p, idx) => (
                            <Draggable
                                key={`${activeUnit.id}-${idx}`}
                                position={{ x: p.x, y: p.y }}
                                scale={scale}
                                onDrag={(e, data) => {
                                    const newPoints = [...activeUnit.points];
                                    newPoints[idx] = { x: data.x, y: data.y };
                                    updateUnit(activeUnit.id, { points: newPoints });
                                }}
                                onStop={(e, data) => {
                                    const newPoints = [...activeUnit.points];
                                    newPoints[idx] = { x: data.x, y: data.y };
                                    updateUnit(activeUnit.id, { points: newPoints });
                                }}
                            >
                                <div style={{
                                    position: 'absolute', width: '8px', height: '8px', background: activeUnit.color, border: '2px solid white',
                                    borderRadius: '50%', marginLeft: '-6px', marginTop: '-6px', cursor: 'grab', zIndex: 200,
                                    boxShadow: '0 0 2px rgba(0,0,0,0.5)'
                                }}>
                                </div>
                            </Draggable>
                        ))}

                        {layers.filter(l => l.visible).flatMap(layer =>
                            (layer.units || []).map(unit => ({ ...unit, _layerId: layer.id }))
                        ).map(unit => {
                            const isLayerActive = unit._layerId === activeLayerId;
                            // Interaction allowed if active layer OR spectator mode (for view only)
                            // Spectators can hover/select/context menu, but NOT drag/edit
                            const isInteractable = !isSpectator || true;
                            const isDraggable = !isSpectator;

                            return (
                                <Draggable
                                    key={unit.id}
                                    position={{ x: unit.x, y: unit.y }}
                                    scale={scale}
                                    disabled={!isDraggable}
                                    onStop={(e, data) => {
                                        // Double safety: Spectators cannot move units
                                        if (isSpectator) return;

                                        // Update ANY unit safely
                                        const newX = data.x;
                                        const newY = data.y;
                                        updateUnit(unit.id, { x: newX, y: newY });

                                        // Collision Check for Merge (fleets only)
                                        if ((!unit.type || unit.type === 'fleet') && !isSpectator) {
                                            // Search ALL visible units for target
                                            const target = allVisibleUnits.find(u => {
                                                if (u.id === unit.id) return false; // Self
                                                if (u.type && u.type !== 'fleet') return false; // Only merge into fleets
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
                                            // Always allow selection if visible
                                            if (activeUnit && activeUnit.type === 'line' && !isSpectator) return;
                                            setSelectedUnitId(unit.id);
                                        }}
                                        onContextMenu={(e) => {
                                            // Allow context menu for spectators too (for Edit View)
                                            handleContextMenu(e, unit.id);
                                        }}
                                        onClick={(e) => {
                                            e.stopPropagation(); setSelectedUnitId(unit.id);
                                        }}
                                        onMouseEnter={() => { if (!selectedUnitId) setHoveredUnitId(unit.id); }}
                                        onMouseLeave={() => setHoveredUnitId(null)}
                                        style={{
                                            position: 'absolute', cursor: isDraggable ? 'grab' : 'default',
                                            // Z-Index: Hover/Selected > Active Layer > Inactive Layer
                                            zIndex: (selectedUnitId === unit.id || hoveredUnitId === unit.id) ? 200 : (isLayerActive ? 150 : 100),
                                            pointerEvents: (activeUnit && activeUnit.type === 'line' && activeUnit.id !== unit.id && !isSpectator) ? 'none' : 'auto', // Keep existing logic?
                                            opacity: ((activeUnit && activeUnit.type === 'line' && activeUnit.id !== unit.id && !isSpectator) ? 0.5 : 1) // Ghost inactive layers
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

                                                {/* Layer Badge for All Layers (Hover Only) */}
                                                {hoveredUnitId === unit.id && (
                                                    <div style={{
                                                        position: 'absolute', bottom: '-4px', left: '-4px',
                                                        background: '#333', color: 'white', fontSize: '8px',
                                                        padding: '1px 3px', borderRadius: '4px', opacity: 0.8
                                                    }}>
                                                        {unit._layerId}
                                                    </div>
                                                )}

                                                {/* Hover List (Active Only) */}
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
                                                        gridTemplateColumns: 'auto auto 1fr',
                                                        alignItems: 'center',
                                                        gap: '0 4px',
                                                        whiteSpace: 'nowrap',
                                                        textShadow: 'none'
                                                    }}>
                                                        {(unit.fleets || []).map((f, fi) => {
                                                            const match = f.code.match(/^(\d{3,4})([A-Z]+)Sq\.$/);
                                                            const typeCode = match ? match[2] : null;
                                                            return (
                                                                <React.Fragment key={fi}>
                                                                    <div style={{
                                                                        display: 'flex',
                                                                        justifyContent: 'center',
                                                                        alignItems: 'center',
                                                                        width: '2.2em',
                                                                        height: '1.6em',
                                                                        overflow: 'hidden'
                                                                    }}>
                                                                        {typeCode && (
                                                                            <img
                                                                                src={`/assets/ships/${typeCode}.png`}
                                                                                alt=""
                                                                                style={{
                                                                                    maxWidth: '100%',
                                                                                    maxHeight: '100%',
                                                                                    objectFit: 'contain',
                                                                                    verticalAlign: 'middle'
                                                                                }}
                                                                                onError={(e) => e.target.style.display = 'none'}
                                                                            />
                                                                        )}
                                                                    </div>
                                                                    <span style={{ fontWeight: 'bold', textAlign: 'left' }}>
                                                                        {f.code}{appSettings?.showFleetNameOnHover !== false ? ' :' : ''}
                                                                    </span>
                                                                    <span>{appSettings?.showFleetNameOnHover !== false ? f.name : ''}</span>
                                                                </React.Fragment>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        {
                                            unit.type === 'label' && (
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
                                            )
                                        }
                                        {
                                            unit.type === 'image' && (
                                                <img src={unit.src} alt="added" style={{ width: unit.width || 100, border: selectedUnitId === unit.id ? '2px solid blue' : 'none' }} />
                                            )
                                        }
                                        {
                                            unit.type === 'shape' && (
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
                                            )
                                        }
                                    </div>
                                </Draggable>
                            );
                        })}
                    </div>
                </div>
            </div >

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
                                    <div className="menu-item" onClick={() => handleMenuAction('edit')}>
                                        {isSpectator ? '詳細を見る' : '編集'}
                                    </div>
                                )}
                                {!isSpectator && (
                                    <>
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
                                )}
                            </>
                        ) : (
                            !isSpectator && (
                                <div className={`menu-item ${!clipboard ? 'disabled' : ''}`} onClick={() => handleMenuAction('paste')}>
                                    貼り付け {clipboard ? `(${clipboard.type})` : ''}
                                </div>
                            )
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

                                    // Perform updates
                                    // 1. Delete Source (from its layer)
                                    deleteUnit(source.id);

                                    // 2. Update Target (in its layer)
                                    // We pass a function to ensure we capture latest state if needed, or just object patch
                                    updateUnit(target.id, { fleets: newFleets });

                                    setMergeCandidate(null);
                                }} style={{ background: '#007bff', color: 'white' }}>統合する</button>
                            </div>
                        </div>
                    </div>
                )
            }
            {/* Image Upload Selection Modal */}
            {
                showImageUploadModal && (
                    <div className="modal-overlay">
                        <div className="modal-content" style={{ width: '300px', background: 'white', padding: '20px', borderRadius: '8px', position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 1200, boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }}>
                            <h3 style={{ marginTop: 0 }}>マップ画像の適用先</h3>
                            <div style={{ margin: '20px 0' }}>
                                <p>アップロードした画像をどのレイヤーに設定しますか？</p>
                                <select
                                    value={uploadTargetLayerId}
                                    onChange={(e) => setUploadTargetLayerId(parseInt(e.target.value))}
                                    style={{ width: '100%', padding: '8px', fontSize: '16px' }}
                                >
                                    {layers.map(l => (
                                        <option key={l.id} value={l.id}>
                                            {l.id === activeLayerId ? '★ ' : ''}{l.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                                <button className="btn" onClick={() => setShowImageUploadModal(false)}>キャンセル</button>
                                <button className="btn btn-primary" style={{ background: '#007bff', color: 'white' }} onClick={handleImageUploadConfirm}>適用</button>
                            </div>
                        </div>
                    </div>
                )
            }
            {
                showLayerPanel && (
                    <div className="layer-panel" style={{
                        position: 'absolute', top: '60px', right: '10px',
                        background: 'white', border: '1px solid #ccc',
                        padding: '10px', borderRadius: '4px', boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
                        zIndex: 1100, width: '250px', maxHeight: '80vh', overflowY: 'auto'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                            <h4 style={{ margin: 0 }}>レイヤー管理</h4>
                            <button onClick={() => setShowLayerPanel(false)} style={{ cursor: 'pointer', border: 'none', background: 'transparent' }}>✖</button>
                        </div>
                        {!isSpectator && (
                            <div style={{ marginBottom: '10px', display: 'flex', gap: '5px' }}>
                                <button className="btn" style={{ fontSize: '0.8em', padding: '2px 5px' }} onClick={handleAddLayer}>+ 追加</button>
                            </div>
                        )}
                        <div className="layer-list" style={{ display: 'flex', flexDirection: 'column', gap: '5px', position: 'relative' }} ref={layerListRef}>
                            {layers.map((layer, index) => {
                                const isDragging = index === draggingLayerIdx;
                                let shiftY = 0;
                                const ITEM_HEIGHT = 50 + 5; // Height + gap roughly
                                if (draggingLayerIdx !== null && !isDragging) {
                                    if (index > draggingLayerIdx && index <= placeholderLayerIdx) {
                                        shiftY = -ITEM_HEIGHT;
                                    } else if (index < draggingLayerIdx && index >= placeholderLayerIdx) {
                                        shiftY = ITEM_HEIGHT;
                                    }
                                }

                                return (
                                    <div key={layer.id} style={{
                                        transition: isDragging ? 'none' : 'transform 0.2s',
                                        transform: `translate3d(0, ${shiftY}px, 0)`,
                                        zIndex: isDragging ? 100 : 0
                                    }}>
                                        <Draggable
                                            axis="y"
                                            position={isDragging ? undefined : { x: 0, y: 0 }}
                                            onStart={(e) => handleLayerDragStart(e, index)}
                                            onDrag={handleLayerDrag}
                                            onStop={handleLayerDragStop}
                                            disabled={isSpectator}
                                            handle=".drag-handle"
                                        >
                                            <div style={{
                                                border: activeLayerId === layer.id ? '2px solid #007bff' : '1px solid #eee',
                                                borderRadius: '4px', padding: '5px',
                                                background: layer.visible ? 'white' : '#f0f0f0',
                                                opacity: (draggingLayerIdx !== null && !isDragging) ? 0.8 : (layer.visible ? 1 : 0.7),
                                                boxShadow: isDragging ? '0 5px 15px rgba(0,0,0,0.2)' : 'none',
                                                position: 'relative',
                                                height: '50px',
                                                boxSizing: 'border-box',
                                                display: 'flex', alignItems: 'center', gap: '5px'
                                            }}>
                                                {!isSpectator && (
                                                    <div className="drag-handle" style={{ cursor: 'grab', color: '#ccc', marginRight: '2px' }}>
                                                        ☰
                                                    </div>
                                                )}

                                                <input
                                                    type="checkbox"
                                                    checked={layer.visible}
                                                    onChange={(e) => {
                                                        // Stop propagation to avoid picking the layer? No, checkbox is fine.
                                                        handleToggleVisibility(layer.id);
                                                    }}
                                                    title="表示/非表示"
                                                    style={{ cursor: 'pointer' }}
                                                />

                                                {editingLayerId === layer.id ? (
                                                    <input
                                                        autoFocus
                                                        defaultValue={layer.name}
                                                        onBlur={(e) => handleRenameLayer(layer.id, e.target.value)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') handleRenameLayer(layer.id, e.currentTarget.value);
                                                            if (e.key === 'Escape') setEditingLayerId(null);
                                                        }}
                                                        onClick={(e) => e.stopPropagation()} // Prevent selecting layer when clicking input
                                                        style={{ flex: 1, padding: '2px 4px' }}
                                                    />
                                                ) : (
                                                    <span
                                                        onClick={() => {
                                                            setActiveLayerId(layer.id);
                                                            if (!layer.visible) handleToggleVisibility(layer.id);
                                                        }}
                                                        onDoubleClick={() => !isSpectator && setEditingLayerId(layer.id)}
                                                        style={{
                                                            cursor: 'pointer',
                                                            fontWeight: activeLayerId === layer.id ? 'bold' : 'normal',
                                                            flex: 1,
                                                            color: activeLayerId === layer.id ? '#007bff' : 'inherit',
                                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                                                        }}
                                                    >
                                                        {layer.name}
                                                    </span>
                                                )}

                                                <div style={{ display: 'flex', gap: '5px', justifyContent: 'flex-end', alignItems: 'center' }}>
                                                    {!isSpectator && (
                                                        <>
                                                            <button
                                                                onClick={() => setEditingLayerId(layer.id)}
                                                                title="名前を変更"
                                                                style={{ fontSize: '0.7em', color: '#333', border: '1px solid #ccc', background: 'white', cursor: 'pointer', marginRight: '2px' }}
                                                            >
                                                                名
                                                            </button>
                                                            <button
                                                                onClick={() => handleDuplicateLayer(layer.id)}
                                                                title="レイヤーを複製"
                                                                style={{ fontSize: '0.7em', color: '#333', border: '1px solid #ccc', background: 'white', cursor: 'pointer', marginRight: '2px' }}
                                                            >
                                                                複
                                                            </button>
                                                            <button disabled={layers.length <= 1} onClick={() => handleDeleteLayer(layer.id)} style={{ fontSize: '0.7em', color: 'red', border: '1px solid #ccc', background: 'white', cursor: 'pointer' }}>×</button>
                                                        </>
                                                    )}
                                                    {layer.mapImage ? (
                                                        <button onClick={() => handleImageDelete(layer.id)} style={{ fontSize: '0.7em', color: 'orange', padding: '1px' }} disabled={isSpectator}>画消</button>
                                                    ) : (
                                                        !isSpectator && <label style={{ fontSize: '0.7em', color: 'blue', cursor: 'pointer', border: '1px dashed blue', padding: '0 2px' }}>
                                                            ＋画<input type="file" hidden accept="image/*" onChange={(e) => {
                                                                const f = e.target.files[0];
                                                                if (f) {
                                                                    const url = URL.createObjectURL(f);
                                                                    setLayers(prev => prev.map(l => l.id === layer.id ? {
                                                                        ...l,
                                                                        mapImage: url,
                                                                        mapImageBlob: f,
                                                                        mapImageX: 0, mapImageY: 0, mapImageScale: 1, mapImageRotation: 0, mapImageOpacity: 1
                                                                    } : l));
                                                                }
                                                            }} />
                                                        </label>
                                                    )}
                                                </div>
                                            </div>
                                        </Draggable>
                                    </div>
                                );
                            })}

                            {/* Layer Image Settings in Panel? Or Sidebar? Plan said Sidebar. */}
                        </div>
                    </div >
                )
            }
        </div >
    );
};

export default MainScreen;