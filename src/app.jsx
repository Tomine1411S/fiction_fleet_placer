import React, { useState, useEffect, useRef } from 'react';
import MainScreen from './components/MainScreen';
import EditScreen from './components/EditScreen';
import SettingsScreen from './components/SettingsScreen';
import ShipListScreen from './components/ShipListScreen';
import { saveProject, loadProject, generateStatusReport } from './utils/fileSystem';
import FleetSplitScreen from './components/FleetSplitScreen';
import { loadCSV } from './utils/csvLoader';
import { calculateDiff, applyDiff } from './utils/diffUtils';
import { io } from 'socket.io-client';
import './app.css'; // スタイル定義が必要

function App() {
    const [currentScreen, setCurrentScreen] = useState('main'); // 'main' or 'edit'
    const [mapImage, setMapImage] = useState(null); // 画像URL
    const [mapImageBlob, setMapImageBlob] = useState(null); // 保存用Blob

    // 部隊データ（ステートの核）
    const [units, setUnits] = useState([]);

    const [selectedUnitId, setSelectedUnitId] = useState(null);
    const [editingShipIndices, setEditingShipIndices] = useState(null); // { fleetIndex, shipIndex }

    // Session & Socket State
    const [sessionId, setSessionId] = useState(null);
    const [spectatorShareId, setSpectatorShareId] = useState(null); // ID for sharing view-only access
    const [isSpectator, setIsSpectator] = useState(false);
    const [socket, setSocket] = useState(null);
    const [isServerSynced, setIsServerSynced] = useState(false); // New: prevent overwriting server data
    const isRemoteUpdate = useRef(false); // Ref to prevents echo loops
    const isRemoteMapUpdate = useRef(false);
    const pendingMasterDiffs = useRef(null); // Valid until Base is loaded

    // Master Data State (Lifted from EditScreen)
    // "Base" data loaded from CSV
    const [baseShipTypes, setBaseShipTypes] = useState([]);
    const [baseShipClasses, setBaseShipClasses] = useState([]);
    const [baseFleetTypes, setBaseFleetTypes] = useState([]);

    // Current working data (Base + Diff)
    const [shipTypes, setShipTypes] = useState([]);
    const [shipClasses, setShipClasses] = useState([]);
    const [fleetTypes, setFleetTypes] = useState([]);

    const isRemoteMasterUpdate = useRef(false); // Ref to prevent echo loops for master data

    // --- Session Init & Socket Connection ---
    useEffect(() => {
        // Parse URL params
        const params = new URLSearchParams(window.location.search);
        let sId = params.get('session');
        const mode = params.get('mode');

        if (mode === 'spectator') {
            setIsSpectator(true);
        }

        if (!sId) {
            // Generate new session ID if missing
            sId = Math.random().toString(36).substring(2, 15);
            const newUrl = `${window.location.pathname}?session=${sId}${mode ? '&mode=' + mode : ''}`;
            window.history.replaceState(null, '', newUrl);
        }
        setSessionId(sId);

        // Connect to Server
        // Connect to Server
        // Local dev: port 3001 (same hostname to support LAN access)
        // Production (behind proxy): relative path (auto-detects domain/port)
        const isDev = import.meta.env.DEV;
        const socketUrl = isDev ? `http://${window.location.hostname}:3001` : '/';

        console.log("Connecting to socket:", socketUrl);
        const newSocket = io(socketUrl);
        setSocket(newSocket);

        newSocket.on('connect', () => {
            console.log("Connected to server");
            newSocket.emit('join_session', sId);
        });

        // Listen for session info (Role & IDs)
        newSocket.on('session_info', (info) => {
            console.log("Session Info:", info);
            setIsSpectator(info.role === 'spectator');
            // Store spectator ID for sharing. 
            // If editor, info.spectatorId is the view-only ID.
            // If spectator, info.spectatorId is the same ID they used (view-only).
            setSpectatorShareId(info.spectatorId);
        });

        newSocket.on('init_data', (data) => {
            console.log("Received init data");
            setIsServerSynced(true); // Mark as synced!

            if (data) {
                if (Array.isArray(data)) {
                    // Legacy (units only)
                    isRemoteUpdate.current = true;
                    setUnits(data);
                } else {
                    // Object { units, mapImage }
                    if (data.units) {
                        isRemoteUpdate.current = true;
                        setUnits(data.units);
                    }
                    if (data.mapImage) {
                        isRemoteMapUpdate.current = true;
                        setMapImage(data.mapImage);
                        // Convert back to blob for saving consistency
                        fetch(data.mapImage).then(res => res.blob()).then(blob => setMapImageBlob(blob));
                    }
                    if (data.masterDiffs) {
                        // Init with server diffs
                        isRemoteMasterUpdate.current = true;
                        // We need to wait for Base CSV to load? 
                        // Use useEffect dependency to apply diff when both Base and Diff exist.
                        // For now store it in a temporary ref or state if base is not ready?
                        // Actually, base load is fast. We can just set them here if base is empty, 
                        // but better to rely on `useEffect` to merge Base + Diff.
                        // Implemented: Just trigger the update logic.
                        // Wait, we need the Base to apply diff.
                        // Let's store the pending diff in state/ref if base is missing?
                        // Or simple hack: Assume Base loads fast.
                        // Better: `base*` states are empty initially. 
                        // Let's use a function to apply pending diffs.

                        // BUT `init_data` might come BEFORE base CSV load finishes.
                        // So we should save the initial diff to a ref/state and applying it when Base is ready.
                    }
                }

                // Handle Master Diffs (Unified logic)
                if (data.masterDiffs) {
                    pendingMasterDiffs.current = data.masterDiffs;
                    // Try apply immediately if ready
                    applyPendingDiffs();
                }
            }
        });

        newSocket.on('server_update', (data) => {
            console.log("Received server update");
            if (data && Array.isArray(data)) {
                isRemoteUpdate.current = true;
                setUnits(data);
            }
        });

        newSocket.on('map_update', (dataUrl) => {
            console.log("Received map update");
            isRemoteMapUpdate.current = true;
            setMapImage(dataUrl);
            fetch(dataUrl).then(res => res.blob()).then(blob => setMapImageBlob(blob));
        });

        newSocket.on('sync_master_diff', (diffs) => {
            console.log("Received master diff sync");
            isRemoteMasterUpdate.current = true;
            pendingMasterDiffs.current = diffs;
            applyPendingDiffs();
        });

        return () => {
            newSocket.disconnect();
        };
    }, [baseShipTypes, baseShipClasses, baseFleetTypes]); // Re-bind if base changes? No, unsafe. Keep empty deps but use refs/state.

    // Helper to apply diffs (needs access to base state, so defined inside component or effect)
    // Since base state changes ONLY ONCE at startup, we can put it in a useEffect dependent on base + pending.

    // ... Actually, putting `applyPendingDiffs` inside the socket effect closure captures stale `base` state (empty strings).
    // Better to use a dedicated useEffect to watch `base*` and `pendingMasterDiffs`.

    // --- Sync Updates to Server ---
    useEffect(() => {
        if (!socket || !sessionId) return;

        // Prevent overwriting server data with initial empty state
        if (!isServerSynced) return;

        // If this change came from the server (isRemoteUpdate), don't echo it back.
        if (isRemoteUpdate.current) {
            isRemoteUpdate.current = false;
            return;
        }

        // If spectator, never emit updates
        if (isSpectator) return;

        // Emit local change
        socket.emit('update_data', { sessionId, units });
    }, [units, socket, sessionId, isSpectator]);

    // --- Sync Map to Server ---
    useEffect(() => {
        if (!socket || !sessionId) return;
        if (isRemoteMapUpdate.current) {
            isRemoteMapUpdate.current = false;
            return;
        }
        if (isSpectator) return;

        if (mapImageBlob) {
            const reader = new FileReader();
            reader.onloadend = () => {
                if (reader.result) {
                    socket.emit('update_map', { sessionId, mapImage: reader.result });
                }
            };
            reader.readAsDataURL(mapImageBlob);
        }
    }, [mapImageBlob, socket, sessionId, isSpectator]);


    // --- Apply Pending Master Diffs ---
    const applyPendingDiffs = () => {
        if (!pendingMasterDiffs.current) return;
        if (baseShipTypes.length === 0 && baseShipClasses.length === 0 && baseFleetTypes.length === 0) return; // Wait for base

        const diffs = pendingMasterDiffs.current;
        console.log("Applying Master Diffs:", diffs);

        if (diffs.shipTypes) {
            setShipTypes(prev => applyDiff(baseShipTypes, diffs.shipTypes, 'ship_type_index'));
        }
        if (diffs.shipClasses) {
            setShipClasses(prev => applyDiff(baseShipClasses, diffs.shipClasses, 'ship_class_index'));
        }
        if (diffs.fleetTypes) {
            setFleetTypes(prev => applyDiff(baseFleetTypes, diffs.fleetTypes, 'type'));
        }
    };

    // Watch for Base Data load to apply pending diffs
    useEffect(() => {
        applyPendingDiffs();
    }, [baseShipTypes, baseShipClasses, baseFleetTypes]);


    // Load Master Data (Base CSV)
    useEffect(() => {
        const loadMasterData = async () => {
            try {
                // Always load CSV as Base
                const typesData = await loadCSV('/assets/ships/ship_class_index.csv');
                const classesData = await loadCSV('/assets/ships/ship_type_index.csv');
                const fleetTypesData = await loadCSV('/assets/fleets/fleet_type.csv');

                setBaseShipTypes(typesData);
                setBaseShipClasses(classesData);
                setBaseFleetTypes(fleetTypesData);

                // Init current as base (will be overwritten by diff apply if pending exists)
                setShipTypes(typesData);
                setShipClasses(classesData);
                setFleetTypes(fleetTypesData);

            } catch (e) {
                console.error("Failed to load master data", e);
            }
        };
        loadMasterData();
    }, []);

    // --- Sync Master Data Changes to Server (Calc Diff) ---
    useEffect(() => {
        // Skip if this update came from server
        if (isRemoteMasterUpdate.current) {
            isRemoteMasterUpdate.current = false;
            return;
        }
        if (isSpectator) return;
        if (!socket || !sessionId) return;
        // Wait until base is loaded to avoid false diffs (empty base vs loaded current?)
        // actually if current is loaded but base is active...
        if (baseShipTypes.length === 0) return;

        const typesDiff = calculateDiff(baseShipTypes, shipTypes, 'ship_type_index');
        const classesDiff = calculateDiff(baseShipClasses, shipClasses, 'ship_class_index');
        const fleetDiff = calculateDiff(baseFleetTypes, fleetTypes, 'type');

        // Only emit if there are changes? 
        // calculateDiff returns empty arrays if no change. 
        // We can check if any array has length > 0.
        const hasChange = (d) => d.added.length > 0 || d.modified.length > 0 || d.deleted.length > 0;

        if (hasChange(typesDiff) || hasChange(classesDiff) || hasChange(fleetDiff)) {
            const diffs = {
                shipTypes: typesDiff,
                shipClasses: classesDiff,
                fleetTypes: fleetDiff
            };
            socket.emit('update_master_diff', { sessionId, diffs });
        }

    }, [shipTypes, shipClasses, fleetTypes, baseShipTypes, baseShipClasses, baseFleetTypes, socket, sessionId, isSpectator]);


    // ファイル操作ハンドラ
    const handleFileUpload = async (e) => {
        if (isSpectator) return; // Disable for spectator
        const file = e.target.files[0];
        if (!file) return;
        if (file.name.endsWith('.zip')) {
            try {
                const data = await loadProject(file);
                // Updates here will trigger useEffect -> emit sync
                // Since we are loading a file, we are authoritative, so we can consider ourselves synced (ready to push)
                setIsServerSynced(true);

                setUnits(data.units || []);
                if (data.mapImage) {
                    setMapImage(data.mapImage);
                    setMapImageBlob(data.mapImageBlob);
                }

                // Handle loaded master diffs
                if (data.masterDiffs) {
                    isRemoteMasterUpdate.current = true;
                    pendingMasterDiffs.current = data.masterDiffs;
                    applyPendingDiffs();
                    // Force sync these loaded diffs to server
                    if (!isSpectator && socket && sessionId) {
                        socket.emit('update_master_diff', { sessionId, diffs: data.masterDiffs });
                    }
                }
            } catch (err) {
                console.error("Failed to load project:", err);
                alert("プロジェクトの読み込みに失敗しました");
            }
        } else if (file.type.startsWith('image/')) {
            setMapImage(URL.createObjectURL(file));
            setMapImageBlob(file);
        }
    };

    // handleDownloadReport removed (unused and erroneous)

    // Spectator / Session Info UI (Optional overlay or passed to MainScreen)
    // For simplicity, passing everything to MainScreen

    return (
        <div className="app-container">
            {/* 共通ヘッダー的な制御は各画面コンポーネント内またはここに配置 */}

            {currentScreen === 'main' ? (
                <MainScreen
                    units={units}
                    setUnits={setUnits}
                    mapImage={mapImage}
                    onSwitchScreen={() => setCurrentScreen('edit')}
                    onOpenSettings={() => setCurrentScreen('settings')}
                    onOpenShipList={() => setCurrentScreen('shipList')}
                    onFileUpload={handleFileUpload}
                    onSaveZip={async () => {
                        try {
                            // Calculate diffs for saving
                            const diffs = {
                                shipTypes: calculateDiff(baseShipTypes, shipTypes, 'ship_type_index'),
                                shipClasses: calculateDiff(baseShipClasses, shipClasses, 'ship_class_index'),
                                fleetTypes: calculateDiff(baseFleetTypes, fleetTypes, 'type')
                            };
                            await saveProject({ units, mapImageBlob, masterDiffs: diffs });
                        } catch (e) {
                            console.error(e);
                            alert("ZIP保存に失敗しました: " + e.message);
                        }
                    }}
                    onDownloadReport={() => { }} // Moved to MainScreen modal
                    selectedUnitId={selectedUnitId}
                    setSelectedUnitId={setSelectedUnitId}
                    fleetTypes={fleetTypes}
                    // New Props
                    isSpectator={isSpectator}
                    sessionId={sessionId}
                    spectatorShareId={spectatorShareId}
                    onOpenSplitScreen={() => setCurrentScreen('split')}
                />
            ) : currentScreen === 'split' ? (
                <FleetSplitScreen
                    units={units}
                    setUnits={setUnits}
                    onSwitchScreen={() => setCurrentScreen('main')}
                    selectedUnitId={selectedUnitId}
                    shipTypes={shipTypes}
                    shipClasses={shipClasses}
                    isSpectator={isSpectator}
                />
            ) : currentScreen === 'edit' ? (
                <EditScreen
                    units={units}
                    setUnits={setUnits}
                    mapImage={mapImage}
                    onSwitchScreen={() => {
                        setCurrentScreen('main');
                        setEditingShipIndices(null);
                    }}
                    selectedUnitId={selectedUnitId}
                    editingShipIndices={editingShipIndices}
                    shipTypes={shipTypes}
                    shipClasses={shipClasses}
                    fleetTypes={fleetTypes}
                    isSpectator={isSpectator}
                />
            ) : currentScreen === 'settings' ? (
                <SettingsScreen
                    onSwitchScreen={() => setCurrentScreen('main')}
                    shipTypes={shipTypes} setShipTypes={setShipTypes}
                    shipClasses={shipClasses} setShipClasses={setShipClasses}
                    fleetTypes={fleetTypes} setFleetTypes={setFleetTypes}
                    isSpectator={isSpectator}
                />
            ) : (
                <ShipListScreen
                    units={units}
                    shipTypes={shipTypes}
                    shipClasses={shipClasses}
                    onSwitchScreen={() => setCurrentScreen('main')}
                    onSelectUnit={(unitId, fleetIndex, shipIndex) => {
                        setSelectedUnitId(unitId);
                        setEditingShipIndices({ fleetIndex, shipIndex });
                        setCurrentScreen('edit');
                    }}
                    isSpectator={isSpectator}
                />
            )}
        </div>
    );
}

export default App;