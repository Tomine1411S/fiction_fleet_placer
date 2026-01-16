import React, { useState, useRef, useEffect } from 'react';
import Draggable from 'react-draggable';

const DraggableWithRef = ({ children, ...props }) => {
    const nodeRef = React.useRef(null);
    return (
        <Draggable nodeRef={nodeRef} {...props}>
            {React.cloneElement(React.Children.only(children), { ref: nodeRef })}
        </Draggable>
    );
};
import { saveAs } from 'file-saver';
import { fileToBase64 } from '../utils/fileUtils';
import { createChildLayer, isPointInBoundary, transformParentToChild } from '../utils/layerUtils';

const MainScreen = ({
    layers = [], setLayers, activeLayerId, setActiveLayerId, // New Props
    fleets = {}, setFleets, // New Global Fleet Store
    units = [], setUnits, mapImage: propMapImage, // Legacy/Compat props (units is activeLayer.units)
    onSwitchScreen, onOpenSettings, onOpenShipList, onFileUpload, onSaveZip, onDownloadReport, selectedUnitId, setSelectedUnitId, fleetTypes, isSpectator, sessionId, spectatorShareId, onOpenSplitScreen,
    appSettings // New Prop
}) => {
    // Helper to resolve fleets for a unit
    const getUnitFleets = (unit) => {
        if (!unit) return [];
        if (unit.fleetIds) return unit.fleetIds.map(id => fleets[id]).filter(Boolean);
        return unit.fleets || [];
    };
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

    // --- Child Layer Creation State ---
    const [showParentSelectModal, setShowParentSelectModal] = useState(false);
    const [boundaryMode, setBoundaryMode] = useState(false);
    const [boundaryStart, setBoundaryStart] = useState(null);
    const [tempBoundary, setTempBoundary] = useState(null); // { x, y, width, height, type: 'rect' }
    const [targetParentId, setTargetParentId] = useState(null);

    const updateLayerImage = (layerId, updates) => {
        setLayers(layers.map(l => l.id === layerId ? { ...l, ...updates } : l));
    };

    // --- Dynamic Sync on Drag (Parent to Child) ---
    const checkParentToChildDrop = (unit, newX, newY) => {
        const childLayers = layers.filter(l => l.parentId === activeLayerId);
        childLayers.forEach(child => {
            if (child.boundary && isPointInBoundary(newX, newY, child.boundary)) {
                // Synced!
                const unitFleets = getUnitFleets(unit);
                const fleetIds = unitFleets.map(f => f.id);

                const alreadyExists = child.units.some(u =>
                    (u.fleetIds && u.fleetIds.some(fid => fleetIds.includes(fid)))
                );

                if (!alreadyExists) {
                    const { x: childX, y: childY } = transformParentToChild(newX, newY, child.boundary);
                    const newChildUnit = {
                        id: Date.now() + Math.random(),
                        x: childX,
                        y: childY,
                        type: 'fleet',
                        fleetIds: fleetIds
                    };

                    setLayers(prev => prev.map(l => l.id === child.id ? {
                        ...l,
                        units: [...l.units, newChildUnit]
                    } : l));
                    console.log(`Synced fleets to child layer ${child.name}`);
                }
            }
        });
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
        const newId = Math.max(...layers.map(l => l.id), 0) + 1;
        setLayers([...layers, {
            id: newId,
            name: `Layer ${newId}`,
            visible: true,
            units: [],
            parentId: null,
            mapImage: null,
            mapImageX: 0,
            mapImageY: 0,
            mapImageScale: 1,
            mapImageRotation: 0,
            mapImageOpacity: 1
        }]);
        setActiveLayerId(newId);
    };

    const handleInitChildLayerCreation = () => {
        if (isSpectator) return;
        setShowParentSelectModal(true);
    };

    const handleSelectParentLayer = (parentId) => {
        setShowParentSelectModal(false);
        setTargetParentId(parentId);
        // Ensure parent is active so we can draw on it
        setActiveLayerId(parentId);
        setBoundaryMode(true);
        alert("マップ上でドラッグして、子レイヤーの範囲（矩形）を指定してください。");
    };

    const handleConfirmBoundary = async (boundary) => {
        setBoundaryMode(false);
        setTempBoundary(null);
        setBoundaryStart(null);

        const parentLayer = layers.find(l => l.id === targetParentId);
        if (!parentLayer) return;

        try {
            const newLayer = await createChildLayer(parentLayer, boundary, fleets, layers, appSettings?.childPlacementMode);

            // Add Child Link Pin to Parent logic
            const linkPin = {
                id: Date.now() + 1,
                x: boundary.x - boundary.width / 2, // Top-Left
                y: boundary.y - boundary.height / 2, // Top-Left
                type: 'child_link',
                targetLayerId: newLayer.id,
                // width: 50, height: 50, // Auto size or specific marker
                color: '#00FFFF',
                displayName: newLayer.name
            };

            // Update Parent with Link Pin
            const updatedParent = {
                ...parentLayer,
                units: [...parentLayer.units, linkPin]
            };

            setLayers([...layers.map(l => l.id === parentLayer.id ? updatedParent : l), newLayer]);

            // Switch to new Child Layer
            setActiveLayerId(newLayer.id);
            alert("子レイヤーを作成しました。");
        } catch (e) {
            console.error(e);
            alert("作成に失敗しました: " + e.message);
        }
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

    // --- Layer Hierarchy Helper ---
    const getHierarchicalLayers = () => {
        const roots = layers.filter(l => !l.parentId);
        // Sort Roots: Reverse order of layers array (Top Z first)
        roots.sort((a, b) => layers.indexOf(b) - layers.indexOf(a));

        const buildTree = (nodes) => {
            let list = [];
            nodes.forEach(node => {
                list.push({ ...node, depth: 0 });
                // Find children
                const children = layers.filter(l => l.parentId === node.id);
                // Sort children (Top Z first)
                children.sort((a, b) => layers.indexOf(b) - layers.indexOf(a));

                if (children.length > 0) {
                    const childNodes = buildTree(children);
                    list = list.concat(childNodes.map(c => ({ ...c, depth: c.depth + 1 })));
                }
            });
            return list;
        };
        return buildTree(roots);
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
        const displayLayers = getHierarchicalLayers(); // Get current visual list
        newIdx = Math.max(0, Math.min(newIdx, displayLayers.length - 1));

        if (newIdx !== placeholderLayerIdx) {
            setPlaceholderLayerIdx(newIdx);
        }
    };

    const handleLayerDragStop = (e, data) => {
        if (draggingLayerIdx === null) return;

        if (draggingLayerIdx !== placeholderLayerIdx) {
            const displayLayers = getHierarchicalLayers();
            const movedLayer = displayLayers[draggingLayerIdx];
            const targetVisualLayer = displayLayers[placeholderLayerIdx];

            if (movedLayer && targetVisualLayer && movedLayer.id !== targetVisualLayer.id) {
                // Determine insertion in 'layers' array (Z-order)
                // Visual List Top = Layer Array End (Highest Index)
                // Visual List Bottom = Layer Array Start (Lowest Index)
                // So "Moving Down Visually" -> "Moving to Lower Array Index"

                const currentLayers = [...layers];
                // Remove moved layer
                const filteredLayers = currentLayers.filter(l => l.id !== movedLayer.id);

                // Find target index in the FILTERED array
                let targetIndex = filteredLayers.findIndex(l => l.id === targetVisualLayer.id);

                if (targetIndex !== -1) {
                    // Logic:
                    // If moving visually DOWN (placeholder > dragging), we want to be BELOW target visually.
                    // Visual Order is reversed layers index. 
                    // Below Visually = Lower Array Index?
                    // Wait.
                    // [B, A] (Visual). B is top. A is bottom.
                    // Array: [A, B]. A=0, B=1.
                    // Move B below A (Visual). [A, B] (Visual).
                    // Target Visual: A.
                    // We want B to be "Below" A visually? No, B is moved AFTER A visually.
                    // Visual List: Index 0 is Top (Z-Max). Index N is Bottom (Z-Min).
                    // DraggingIdx < PlaceholderIdx => Moving Down (Towards Bottom/Z-Min).
                    // Target is at Z-Middle. We want to be Z-Lower than Target?
                    // Yes. If I drop "Below" A, I want to be rendered "Under" A (or just after in list).
                    // Actually, "Visual List" order is "Selection/Panel Order".
                    // Does Panel Order Top = Front? Yes usually.

                    // So Placeholder > Dragging (Moved Down) -> Insert at/before Target in Array? 
                    // Let's assume Insert BEFORE Target in Array (Lower Index).
                    // Placeholder < Dragging (Moved Up) -> Insert AFTER Target in Array (Higher Index).

                    let insertionIndex = targetIndex; // Default: Replace (Insert at same index, shifting target up)

                    if (placeholderLayerIdx > draggingLayerIdx) {
                        // Moved Down Visually -> Z-Order Lower -> Lower Array Index.
                        // Insert at targetIndex. (Target shifts to right/up? No, Target stays at index or becomes index+1?)
                        // [A, C]. Target C(1). Insert B at 1 -> [A, B, C]. B(1) < C(2). B is below C visually?
                        // Sort b-a: 2-1=+ (C first), 1-0=+ (B first). Visual: C, B, A.
                        // If I move B down to A. Target A(0).
                        // Insert at 0. [B, A, C]. B(0), A(1).
                        // Visual: C, A, B.
                        // Wait.
                        // Let's stick to "Insert After" or "Insert Before" in Array.

                        // IF moved visually DOWN (Index increases): We want to be "Behind" target?
                        // Usually dropping "After" an item in a list means "Next Item".
                        // In Z-Stack, "Next Item" = Lower Z? (If Top is first). Yes.
                        // Lower Z = Lower Array Index.
                        // So we want index <= Target Index.
                        // filteredLayers[targetIndex] is the target.
                        // If we insert at targetIndex, the previous content at targetIndex shifts to targetIndex+1.
                        // New item takes targetIndex.
                        // So New Item Index < Old Target Item Index (now +1).
                        // New(X) < Target(X+1). So New is Below Target. Correct.
                        // So: insertionIndex = targetIndex.
                    } else {
                        // Moved Up Visually -> Z-Order Higher -> Higher Array Index.
                        // We want New Index > Target Index.
                        // If we insert at targetIndex + 1.
                        // [A]. Target A(0). Insert B at 1. [A, B].
                        // B(1) > A(0). B Above A. Correct.
                        insertionIndex = targetIndex + 1;
                    }

                    filteredLayers.splice(insertionIndex, 0, movedLayer);
                    setLayers(filteredLayers);
                }
            }
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

        // Clone units and fleets
        // We want semantic copy: separate fleets.
        const newFleetsMap = {};

        const newUnits = (targetLayer.units || []).map((u, i) => {
            // Basic clone
            const unitClone = { ...u, id: Date.now() + i + Math.floor(Math.random() * 1000) };

            // If unit has fleets, we need to clone them too
            const sourceFleets = getUnitFleets(u);
            const newFleetIds = [];

            sourceFleets.forEach(f => {
                const newFleetId = Date.now() + Math.random() + Math.random(); // Ensure unique
                const newFleet = { ...f, id: newFleetId };
                newFleetsMap[newFleetId] = newFleet;
                newFleetIds.push(newFleetId);
            });

            if (newFleetIds.length > 0) {
                unitClone.fleetIds = newFleetIds;
                delete unitClone.fleets; // Ensure clean state
            }

            return unitClone;
        });

        // Update Fleets Store
        setFleets(prev => ({ ...prev, ...newFleetsMap }));

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
                        // Resolve Fleets
                        const unitFleets = getUnitFleets(unit);

                        // Pin Name
                        const pinName = unit.displayName || unitFleets.map(f => f.code).join(' + ') || 'No Name';
                        text += `・${pinName}\n`;
                        unitFleets.forEach(fleet => {
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
                        const unitFleets = getUnitFleets(unit);
                        const pinName = unit.displayName || unitFleets.map(f => f.code).join(' + ') || 'No Name';

                        unitFleets.forEach(fleet => {
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

                const uFleets = getUnitFleets(u);
                if (uFleets.length > 0) {
                    if (uFleets.some(f => {
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
    const mapRef = useRef(null);

    // activeUnit logic: Search ALL visible layers (or all layers?) 
    // Requirement: "Non-active but currently selected layer... can edit fleet info"
    // So we should search all layers for the selected ID.
    const isChildMode = activeLayer && activeLayer.parentId;
    const renderableLayers = layers.filter(layer => {
        if (!layer.visible) return false;
        if (isChildMode) return layer.id === activeLayerId;
        return !layer.parentId;
    });

    // activeUnit logic: Search ALL visible layers (or all layers?) 
    // Requirement: "Non-active but currently selected layer... can edit fleet info"
    // So we should search all layers for the selected ID.
    const allVisibleUnits = renderableLayers.flatMap(l => l.units || []);
    const activeUnit = allVisibleUnits.find(u => u.id === (selectedUnitId || hoveredUnitId));

    // --- Map Control Handlers ---
    useEffect(() => {
        const handleWheelNonPassive = (e) => {
            if (e.ctrlKey || e.metaKey || true) {
                e.preventDefault();
                const scaleAmount = -e.deltaY * 0.001;
                setScale(prev => Math.min(Math.max(0.1, prev + scaleAmount), 5));
            }
        };
        const el = mapRef.current;
        if (el) el.addEventListener('wheel', handleWheelNonPassive, { passive: false });
        return () => { if (el) el.removeEventListener('wheel', handleWheelNonPassive); };
    }, []);

    const handleWheel = () => { }; // No-op now

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
            const newFleetId = Date.now();
            const newFleet = {
                id: newFleetId,
                code: 'New',
                name: 'New Fleet',
                ships: [],
                remarks: ''
            };
            setFleets(prev => ({ ...prev, [newFleetId]: newFleet }));

            updateUnit(targetUnit.id, (u) => {
                const newIds = u.fleetIds ? [...u.fleetIds] : (u.fleets ? [] : []); // If upgrading legacy
                newIds.push(newFleetId);
                return { ...u, fleetIds: newIds };
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
            const newFleetId = newId + 1;
            const newFleet = { id: newFleetId, code: 'NewUnit', name: 'New Fleet', ships: [], remarks: '' };
            setFleets(prev => ({ ...prev, [newFleetId]: newFleet }));

            newUnit = {
                ...newUnit,
                fleetIds: [newFleetId]
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
                                {getUnitFleets(activeUnit).map((f, i) => {
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
                                type="range" min="0.1" max="10.0" step="0.05"
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
                    {activeLayer.parentId && (
                        <div className="breadcrumb" style={{ marginRight: '10px', fontWeight: 'bold' }}>
                            <button className="btn" onClick={() => setActiveLayerId(activeLayer.parentId)}>⬅ 親レイヤーへ戻る</button>
                            <span style={{ marginLeft: '10px' }}>{activeLayer.name}</span>
                        </div>
                    )}

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
                        {!isSpectator && <button className="btn" style={{ background: '#e6f7ff' }} onClick={handleInitChildLayerCreation}>＋子レイヤー作成</button>}
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
                    ref={mapRef}
                    className="map-container"
                    onContextMenu={handleMapContextMenu}
                    onMouseDown={(e) => {
                        if (boundaryMode) {
                            // Boundary Drawing Logic
                            e.preventDefault();
                            const rect = mapRef.current.getBoundingClientRect();
                            const x = (e.clientX - rect.left - position.x) / scale;
                            const y = (e.clientY - rect.top - position.y) / scale;
                            setBoundaryStart({ x, y });
                            setTempBoundary({ x, y, width: 0, height: 0, type: 'rect' });
                        } else {
                            handleMouseDown(e);
                        }
                    }}
                    onMouseMove={(e) => {
                        if (boundaryMode && boundaryStart) {
                            const rect = mapRef.current.getBoundingClientRect();
                            const x = (e.clientX - rect.left - position.x) / scale;
                            const y = (e.clientY - rect.top - position.y) / scale;

                            const minX = Math.min(boundaryStart.x, x);
                            const minY = Math.min(boundaryStart.y, y);
                            const width = Math.abs(x - boundaryStart.x);
                            const height = Math.abs(y - boundaryStart.y);

                            // Center-based storage for consistency with layerUtils
                            // center = minX + width/2
                            setTempBoundary({
                                x: minX + width / 2,
                                y: minY + height / 2,
                                width,
                                height,
                                type: 'rect'
                            });
                        } else {
                            handleMouseMove(e);
                        }
                    }}
                    onMouseUp={(e) => {
                        if (boundaryMode && boundaryStart) {
                            // Finish Drawing
                            if (tempBoundary && tempBoundary.width > 10) {
                                // Confirm?
                                if (window.confirm("この範囲で子レイヤーを作成しますか？")) {
                                    handleConfirmBoundary(tempBoundary);
                                } else {
                                    setBoundaryStart(null);
                                    setTempBoundary(null);
                                }
                            } else {
                                setBoundaryStart(null);
                                setTempBoundary(null);
                            }
                        } else {
                            handleMouseUp();
                        }
                    }}
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
                        {/* Map Images Layer (Stacked) */}
                        {renderableLayers.map((layer, index) => (
                            <img
                                key={`map-layer-${layer.id}`}
                                src={layer.mapImage}
                                alt={`Map ${layer.name}`}
                                style={{
                                    position: 'absolute', top: 0, left: 0,
                                    zIndex: index, // Stack based on layer order
                                    display: 'block',
                                    pointerEvents: 'none',
                                    userSelect: 'none',
                                    WebkitUserDrag: 'none',
                                    transformOrigin: '0 0',
                                    transform: `translate(${layer.mapImageX || 0}px, ${layer.mapImageY || 0}px) rotate(${layer.mapImageRotation || 0}deg) scale(${layer.mapImageScale || 1})`,
                                    opacity: layer.mapImageOpacity ?? 1
                                }}
                            />
                        ))}

                        {/* Passive Child Layer Boundaries (Visible when in Parent Layer) */}
                        {layers.filter(l => l.parentId === activeLayerId && l.boundary).map(child => (
                            <div
                                key={`boundary-${child.id}`}
                                style={{
                                    position: 'absolute',
                                    left: child.boundary.x - child.boundary.width / 2,
                                    top: child.boundary.y - child.boundary.height / 2,
                                    width: child.boundary.width,
                                    height: child.boundary.height,
                                    border: '1px solid rgba(0, 0, 0, 0.3)', // Faint border
                                    pointerEvents: 'none',
                                    zIndex: 60 // Behind units
                                }}
                            />
                        ))}

                        {/* Map Lines SVG Layer */}
                        <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none', zIndex: 50 }}>
                            <defs>
                                {['#FF0000', '#0000FF', '#008000', '#FFA500', '#800080', '#008080', '#000000', '#FF1493'].map(c => (
                                    <marker key={c} id={`arrow-${c.replace('#', '')}`} markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                                        <polygon points="0 0, 10 3.5, 0 7" fill={c} />
                                    </marker>
                                ))}
                            </defs>
                            {renderableLayers.flatMap(layer =>
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


                        {/* Selected Child Layer Boundary Visualization */}
                        {(() => {
                            const targetUnitId = selectedUnitId || hoveredUnitId;
                            const selectedUnit = allVisibleUnits.find(u => u.id === targetUnitId);
                            if (selectedUnit && selectedUnit.type === 'child_link' && selectedUnit.targetLayerId) {
                                const targetLayer = layers.find(l => l.id === selectedUnit.targetLayerId);
                                if (targetLayer && targetLayer.boundary) {
                                    const b = targetLayer.boundary;
                                    return (
                                        <div style={{
                                            position: 'absolute',
                                            left: b.x - b.width / 2,
                                            top: b.y - b.height / 2,
                                            width: b.width,
                                            height: b.height,
                                            border: '3px solid cyan',
                                            backgroundColor: 'rgba(0, 255, 255, 0.1)',
                                            pointerEvents: 'none',
                                            zIndex: 90,
                                            boxShadow: '0 0 10px cyan'
                                        }}>
                                            <div style={{
                                                position: 'absolute',
                                                top: '-25px',
                                                left: '0',
                                                color: 'white',
                                                background: 'rgba(0, 100, 100, 0.8)',
                                                padding: '2px 8px',
                                                borderRadius: '4px',
                                                fontSize: '12px',
                                                whiteSpace: 'nowrap'
                                            }}>
                                                {targetLayer.name} Scope
                                            </div>
                                        </div>
                                    );
                                }
                            }
                            return null;
                        })()}
                        {tempBoundary && (
                            <div style={{
                                position: 'absolute',
                                left: tempBoundary.x - tempBoundary.width / 2,
                                top: tempBoundary.y - tempBoundary.height / 2,
                                width: tempBoundary.width,
                                height: tempBoundary.height,
                                border: '2px dashed blue',
                                backgroundColor: 'rgba(0, 100, 255, 0.2)',
                                pointerEvents: 'none',
                                zIndex: 1000
                            }} />
                        )}

                        {/* Line Handles (Selected Line Only - Any Layer) */}
                        {(!isSpectator && activeUnit && activeUnit.type === 'line' && activeUnit.id === selectedUnitId) && activeUnit.points && activeUnit.points.map((p, idx) => (
                            <DraggableWithRef
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
                            </DraggableWithRef>
                        ))}

                        {renderableLayers.flatMap(layer =>
                            (layer.units || []).map(unit => ({ ...unit, _layerId: layer.id }))
                        ).map(unit => {
                            const isLayerActive = unit._layerId === activeLayerId;
                            // Interaction allowed if active layer OR spectator mode (for view only)
                            // Spectators can hover/select/context menu, but NOT drag/edit
                            const isInteractable = !isSpectator || true;
                            const isDraggable = !isSpectator;

                            return (
                                <DraggableWithRef
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

                                        // Sync check
                                        checkParentToChildDrop(unit, newX, newY);

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
                                        onDoubleClick={(e) => {
                                            if (unit.type === 'child_link' && unit.targetLayerId) {
                                                e.stopPropagation();
                                                setActiveLayerId(unit.targetLayerId);
                                            }
                                        }}
                                        style={{
                                            position: 'absolute', cursor: isDraggable ? 'grab' : 'default',
                                            // Z-Index: Hover/Selected > Active Layer > Inactive Layer
                                            zIndex: (selectedUnitId === unit.id || hoveredUnitId === unit.id) ? 200 : (isLayerActive ? 150 : 100),
                                            pointerEvents: (activeUnit && activeUnit.type === 'line' && activeUnit.id !== unit.id && !isSpectator) ? 'none' : 'auto', // Keep existing logic?
                                            opacity: ((activeUnit && activeUnit.type === 'line' && activeUnit.id !== unit.id && !isSpectator) ? 0.5 : 1) // Ghost inactive layers
                                        }}
                                    >
                                        {(!unit.type || unit.type === 'fleet' || unit.type === 'child_link') && (
                                            <div
                                                style={{
                                                    color: unit.color || 'red',
                                                    fontWeight: 'bold',
                                                    textShadow: (selectedUnitId === unit.id || (!selectedUnitId && hoveredUnitId === unit.id)) ? '2px 2px 2px rgba(0,0,0,0.8), 0 0 5px white' : '0 0 3px white',
                                                    whiteSpace: 'nowrap'
                                                }}
                                            >
                                                {unit.type === 'child_link' ? '🔗' : '▼'}
                                                <span className="unit-label" style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'top', textAlign: 'left', whiteSpace: 'normal' }}>
                                                    {unit.type === 'child_link' ?
                                                        (layers.find(l => l.id === unit.targetLayerId)?.name || unit.displayName || 'Child Layer') :
                                                        (unit.displayName ?
                                                            unit.displayName.split(/\u3000\u3000/).map((str, i) => <div key={i}>{str}</div>) :
                                                            (getUnitFleets(unit).map(f => f.code).join(' + ') || 'No Name')
                                                        )
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
                                                        // Grid or Block depending on content
                                                        display: (unit.type === 'child_link' && appSettings?.linkPinTooltipMode === 'grouped') ? 'block' : 'grid',
                                                        gridTemplateColumns: (unit.type === 'child_link' && appSettings?.linkPinTooltipMode === 'grouped') ? 'none' : 'auto auto 1fr',
                                                        alignItems: 'center',
                                                        gap: '0 4px',
                                                        whiteSpace: 'nowrap',
                                                        textShadow: 'none',
                                                        textAlign: 'left'
                                                    }}>

                                                        {unit.type === 'child_link' ? (
                                                            // Child Link Logic
                                                            (appSettings?.linkPinTooltipMode === 'grouped') ? (
                                                                // Grouped Mode
                                                                (() => {
                                                                    const targetL = layers.find(l => l.id === unit.targetLayerId);
                                                                    if (!targetL) return null;
                                                                    const fleetUnits = targetL.units.filter(u => (!u.type || u.type === 'fleet') && u.fleetIds && u.fleetIds.length > 0);

                                                                    return fleetUnits.map((u, ui) => {
                                                                        const uFleets = u.fleetIds.map(fid => fleets[fid]).filter(Boolean);
                                                                        const pinName = u.displayName || uFleets.map(f => f.code).join(' + ');

                                                                        return (
                                                                            <div key={ui} style={{ marginBottom: ui < fleetUnits.length - 1 ? '6px' : '0' }}>
                                                                                <div style={{ fontWeight: 'bold', borderBottom: '1px solid #eee', marginBottom: '2px', paddingBottom: '1px' }}>
                                                                                    {pinName}
                                                                                </div>
                                                                                <div style={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr', gap: '0 4px', alignItems: 'center' }}>
                                                                                    {uFleets.map((f, fi) => {
                                                                                        const match = f.code.match(/^(\d{3,4})([A-Z]+)Sq\.$/);
                                                                                        const typeCode = match ? match[2] : null;
                                                                                        return (
                                                                                            <React.Fragment key={fi}>
                                                                                                <div style={{ width: '2.2em', height: '1.6em', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                                                    {typeCode && <img src={`/assets/ships/${typeCode}.png`} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} onError={(e) => e.target.style.display = 'none'} />}
                                                                                                </div>
                                                                                                <span style={{ fontWeight: 'bold' }}>{f.code}{appSettings?.showFleetNameOnHover !== false ? ' :' : ''}</span>
                                                                                                <span>{appSettings?.showFleetNameOnHover !== false ? f.name : ''}</span>
                                                                                            </React.Fragment>
                                                                                        );
                                                                                    })}
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    });
                                                                })()
                                                            ) : (
                                                                // Flat Mode (Existing)
                                                                (() => {
                                                                    const targetL = layers.find(l => l.id === unit.targetLayerId);
                                                                    if (!targetL) return [];
                                                                    const allFids = targetL.units.flatMap(u => u.fleetIds || []);
                                                                    const uniqueFids = [...new Set(allFids)];
                                                                    return uniqueFids.map(id => fleets[id]).filter(Boolean).map((f, fi) => {
                                                                        const match = f.code.match(/^(\d{3,4})([A-Z]+)Sq\.$/);
                                                                        const typeCode = match ? match[2] : null;
                                                                        return (
                                                                            <React.Fragment key={fi}>
                                                                                <div style={{ width: '2.2em', height: '1.6em', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                                    {typeCode && <img src={`/assets/ships/${typeCode}.png`} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} onError={(e) => e.target.style.display = 'none'} />}
                                                                                </div>
                                                                                <span style={{ fontWeight: 'bold' }}>{f.code}{appSettings?.showFleetNameOnHover !== false ? ' :' : ''}</span>
                                                                                <span>{appSettings?.showFleetNameOnHover !== false ? f.name : ''}</span>
                                                                            </React.Fragment>
                                                                        );
                                                                    });
                                                                })()
                                                            )
                                                        ) : (
                                                            // Normal Fleet Unit Logic
                                                            getUnitFleets(unit).map((f, fi) => {
                                                                const match = f.code.match(/^(\d{3,4})([A-Z]+)Sq\.$/);
                                                                const typeCode = match ? match[2] : null;
                                                                return (
                                                                    <React.Fragment key={fi}>
                                                                        <div style={{ width: '2.2em', height: '1.6em', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                            {typeCode && <img src={`/assets/ships/${typeCode}.png`} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} onError={(e) => e.target.style.display = 'none'} />}
                                                                        </div>
                                                                        <span style={{ fontWeight: 'bold' }}>{f.code}{appSettings?.showFleetNameOnHover !== false ? ' :' : ''}</span>
                                                                        <span>{appSettings?.showFleetNameOnHover !== false ? f.name : ''}</span>
                                                                    </React.Fragment>
                                                                );
                                                            })
                                                        )}
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
                                </DraggableWithRef>
                            );
                        })
                        }
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

                                    // Resolve fleets using new store logic
                                    const sourceFleets = getUnitFleets(source);
                                    // We need their IDs. The objects themselves are in 'fleets'.
                                    // If source unit was legacy, getUnitFleets extracted/migrated them?
                                    // Actually getUnitFleets just returns objects.
                                    // We need IDs.
                                    const sourceFleetIds = source.fleetIds || sourceFleets.map(f => f.id);
                                    const targetFleetIds = target.fleetIds || (target.fleets || []).map(f => f.id);

                                    // Merge IDs
                                    const newFleetIds = [...targetFleetIds, ...sourceFleetIds];

                                    // 1. Delete Source
                                    deleteUnit(source.id);

                                    // 2. Update Target
                                    updateUnit(target.id, { fleetIds: newFleetIds });
                                    // Note: If target had legacy 'fleets', we should probably clear it or migrate it?
                                    // updateUnit merges props?
                                    // The updateUnit implementation maps units.
                                    // Check if we need to unset 'fleets' on target if it existed.
                                    // The patch is applied.
                                    // Ideally we delete 'fleets' property if we set 'fleetIds'.
                                    // But updateUnit merges.
                                    // We can pass undefined? JSON stringify might drop it.
                                    // Or just ignore 'fleets' if 'fleetIds' exists (getUnitFleets handles this).

                                    setMergeCandidate(null);
                                }} style={{ background: '#007bff', color: 'white' }}>統合する</button>
                            </div>
                        </div>
                    </div>
                )
            }
            {/* Parent Layer Selection Modal */}
            {
                showParentSelectModal && (
                    <div className="modal-overlay" style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        background: 'rgba(0,0,0,0.5)', zIndex: 1200,
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                        <div className="modal-content" style={{ background: 'white', padding: '20px', borderRadius: '8px', minWidth: '350px' }}>
                            <h3>親レイヤーの選択</h3>
                            <p>作成する子レイヤーの親となるレイヤーを選択してください。</p>
                            <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #ccc', margin: '15px 0' }}>
                                {layers.filter(l => !l.parentId).map(l => ( // Only root/parent layers can be parents for now? Or nested? Let's allow any except self (complex). For now, roots.
                                    <div key={l.id}
                                        onClick={() => handleSelectParentLayer(l.id)}
                                        style={{ padding: '10px', borderBottom: '1px solid #eee', cursor: 'pointer', background: targetParentId === l.id ? '#e6f7ff' : 'white' }}
                                    >
                                        {l.name}
                                    </div>
                                ))}
                            </div>
                            <div style={{ textAlign: 'right' }}>
                                <button className="btn" onClick={() => setShowParentSelectModal(false)}>キャンセル</button>
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
                        zIndex: 1100, width: '375px', maxHeight: '80vh', overflow: 'auto',
                        resize: 'horizontal', minWidth: '200px'
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
                            {(() => {
                                const displayLayers = getHierarchicalLayers();

                                return displayLayers.map((layer, index) => {
                                    const isDragging = index === draggingLayerIdx;

                                    return (
                                        <div key={layer.id} style={{
                                            marginLeft: `${(layer.depth || 0) * 20}px`,
                                            position: 'relative',
                                            zIndex: isDragging ? 100 : 0
                                        }}>
                                            <DraggableWithRef
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
                                                        onChange={(e) => handleToggleVisibility(layer.id)}
                                                        title="表示/非表示"
                                                        style={{ cursor: 'pointer' }}
                                                    />

                                                    {/* Edit Name Logic */}
                                                    {editingLayerId === layer.id ? (
                                                        <input
                                                            autoFocus
                                                            defaultValue={layer.name}
                                                            onBlur={(e) => handleRenameLayer(layer.id, e.target.value)}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') handleRenameLayer(layer.id, e.currentTarget.value);
                                                                if (e.key === 'Escape') setEditingLayerId(null);
                                                            }}
                                                            onClick={(e) => e.stopPropagation()}
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
                                                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                                fontSize: layer.depth > 0 ? '0.9em' : '1em'
                                                            }}
                                                        >
                                                            {layer.name}
                                                        </span>
                                                    )}

                                                    <div style={{ display: 'flex', gap: '5px', justifyContent: 'flex-end', alignItems: 'center' }}>
                                                        {!isSpectator && (
                                                            <>
                                                                <button
                                                                    onClick={() => handleAddChildLayer(layer.id)}
                                                                    title="詳細(子)レイヤーを追加"
                                                                    style={{ fontSize: '0.7em', color: '#007bff', border: '1px solid #ccc', background: 'white', cursor: 'pointer', marginRight: '2px', fontWeight: 'bold' }}
                                                                >
                                                                    +子
                                                                </button>
                                                                <button
                                                                    onClick={() => setEditingLayerId(layer.id)}
                                                                    style={{ fontSize: '0.7em', color: '#333', border: '1px solid #ccc', background: 'white', cursor: 'pointer', marginRight: '2px' }}
                                                                >
                                                                    名
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDuplicateLayer(layer.id)}
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
                                            </DraggableWithRef>
                                        </div>
                                    );
                                });
                            })()}
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default MainScreen;
