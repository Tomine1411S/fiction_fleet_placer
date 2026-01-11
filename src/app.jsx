import React, { useState, useEffect, useRef } from 'react';
import MainScreen from './components/MainScreen';
import EditScreen from './components/EditScreen';
import SettingsScreen from './components/SettingsScreen';
import ShipListScreen from './components/ShipListScreen';
import { saveProject, loadProject, generateStatusReport } from './utils/fileSystem';
import FleetSplitScreen from './components/FleetSplitScreen';
import { loadCSV } from './utils/csvLoader';
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

    // Master Data State (Lifted from EditScreen)
    // Base Data (Original CSV)
    const [baseShipTypes, setBaseShipTypes] = useState([]);
    const [baseShipClasses, setBaseShipClasses] = useState([]);
    const [baseFleetTypes, setBaseFleetTypes] = useState([]);

    // Current Working Data
    const [shipTypes, setShipTypes] = useState([]);
    const [shipClasses, setShipClasses] = useState([]);
    const [fleetTypes, setFleetTypes] = useState([]);

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
                    if (data.overrides) {
                        if (data.overrides.shipTypes) setShipTypes(data.overrides.shipTypes);
                        if (data.overrides.shipClasses) setShipClasses(data.overrides.shipClasses);
                        if (data.overrides.fleetTypes) setFleetTypes(data.overrides.fleetTypes);
                    }
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

        newSocket.on('config_update', (overrides) => {
            console.log("Received config update");
            if (overrides) {
                if (overrides.shipTypes) setShipTypes(overrides.shipTypes);
                if (overrides.shipClasses) setShipClasses(overrides.shipClasses);
                if (overrides.fleetTypes) setFleetTypes(overrides.fleetTypes);
                // Optional: visual indicator or toast instead of alert causing interruption
                // alert("設定ファイル(config)が同期されました。"); 
                console.log("Config synced from server");
            }
        });

        return () => {
            newSocket.disconnect();
        };
    }, []);

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


    // Load Master Data
    useEffect(() => {
        const loadMasterData = async () => {
            try {
                // 1. Try LocalStorage
                const savedConfig = localStorage.getItem('restia_fleet_config');
                if (savedConfig) {
                    const parsed = JSON.parse(savedConfig);
                    if (parsed.shipTypes) setShipTypes(parsed.shipTypes);
                    if (parsed.shipClasses) setShipClasses(parsed.shipClasses);
                    if (parsed.fleetTypes) setFleetTypes(parsed.fleetTypes);
                } else {
                    // 2. Fallback to CSV
                    const typesData = await loadCSV('/assets/ships/ship_class_index.csv');
                    const classesData = await loadCSV('/assets/ships/ship_type_index.csv');
                    const fleetTypesData = await loadCSV('/assets/fleets/fleet_type.csv');

                    setBaseShipTypes(typesData);
                    setBaseShipClasses(classesData);
                    setBaseFleetTypes(fleetTypesData);

                    setShipTypes(typesData);
                    setShipClasses(classesData);
                    setFleetTypes(fleetTypesData);
                }
            } catch (e) {
                console.error("Failed to load master data", e);
            }
        };
        loadMasterData();
    }, []);

    // Save Master Data to LocalStorage on change
    useEffect(() => {
        if (shipTypes.length === 0 && shipClasses.length === 0 && fleetTypes.length === 0) return; // Skip initial empty
        const config = { shipTypes, shipClasses, fleetTypes };
        localStorage.setItem('restia_fleet_config', JSON.stringify(config));
    }, [shipTypes, shipClasses, fleetTypes]);

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

                // Apply Config Overrides
                if (data.overrides) {
                    if (data.overrides.shipTypes) setShipTypes(data.overrides.shipTypes);
                    if (data.overrides.shipClasses) setShipClasses(data.overrides.shipClasses);
                    if (data.overrides.fleetTypes) setFleetTypes(data.overrides.fleetTypes);
                    alert("設定ファイル(config)による上書き設定を適用しました。");

                    // Emit to server
                    if (socket && sessionId && !isSpectator) {
                        socket.emit('update_config', { sessionId, overrides: data.overrides });
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
                            const overrides = {};
                            // Helper to check for equality
                            const hasChanged = (base, current) => JSON.stringify(base) !== JSON.stringify(current);

                            if (hasChanged(baseShipTypes, shipTypes)) overrides.shipTypes = shipTypes;
                            if (hasChanged(baseShipClasses, shipClasses)) overrides.shipClasses = shipClasses;
                            if (hasChanged(baseFleetTypes, fleetTypes)) overrides.fleetTypes = fleetTypes;

                            await saveProject({ units, mapImageBlob, mapImage, overrides });
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