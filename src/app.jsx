import React, { useState, useEffect, useRef } from 'react';
import MainScreen from './components/MainScreen';
import EditScreen from './components/EditScreen';
import SettingsScreen from './components/SettingsScreen';
import ShipListScreen from './components/ShipListScreen';
import { saveProject, loadProject, generateStatusReport } from './utils/fileSystem';
import FleetSplitScreen from './components/FleetSplitScreen';
import { loadCSV } from './utils/csvLoader';
import { io } from 'socket.io-client';
import { fileToBase64 } from './utils/fileUtils';
import './app.css'; // スタイル定義が必要

function App() {
    const [currentScreen, setCurrentScreen] = useState('main'); // 'main' or 'edit'
    const [mapImage, setMapImage] = useState(null); // 画像URL
    const [mapImageBlob, setMapImageBlob] = useState(null); // 保存用Blob

    // 部隊データ（ステートの核）
    // const [units, setUnits] = useState([]); // Removed in favor of layers
    const [layers, setLayers] = useState([
        { id: 1, name: 'Layer 1', visible: true, units: [], mapImage: null, mapImageBlob: null }
    ]);
    const [activeLayerId, setActiveLayerId] = useState(1);

    // Derived State for backward compatibility / child props
    const activeLayer = layers.find(l => l.id === activeLayerId) || layers[0] || { units: [], id: 1, visible: true, name: 'Fallback Layer' };
    const units = activeLayer.units;
    const setUnits = (newUnits) => {
        setLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, units: newUnits } : l));
    };

    // Effective Map Image Logic (Shared)
    const currentMapImage = React.useMemo(() => {
        const sorted = [...layers].sort((a, b) => a.id - b.id);
        const activeIndex = sorted.findIndex(l => l.id === activeLayerId);
        if (activeIndex === -1) return null;

        for (let i = activeIndex; i >= 0; i--) {
            if (sorted[i].visible && sorted[i].mapImage) return sorted[i].mapImage;
        }
        return null; // Fallback to null (no image)
    }, [layers, activeLayerId]);

    // Fallback logic for map background (used in App for shared state if needed, but mainly for MainScreen)
    // We don't expose a single 'mapImage' state anymore, MainScreen picks it up.

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

    // App Settings
    const [appSettings, setAppSettings] = useState({ showFleetNameOnHover: true });

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
            setSpectatorShareId(info.spectatorId);
        });

        newSocket.on('init_data', (data) => {
            console.log("Received init data");
            setIsServerSynced(true); // Mark as synced!

            if (data) {
                if (Array.isArray(data)) {
                    // Legacy (units only) -> Layer 1
                    isRemoteUpdate.current = true;
                    setLayers([{ id: 1, name: 'Layer 1', visible: true, units: data, mapImage: null }]);
                } else if (data.layers) {
                    // New Layered Data
                    isRemoteUpdate.current = true;
                    setLayers((data.layers && data.layers.length > 0) ? data.layers : [{ id: 1, name: 'Layer 1', visible: true, units: [], mapImage: null }]);
                    if (data.activeLayerId) setActiveLayerId(data.activeLayerId);
                } else {
                    // Object { units, mapImage } -> Layer 1
                    isRemoteUpdate.current = true;
                    setLayers([{
                        id: 1, name: 'Layer 1', visible: true,
                        units: data.units || [],
                        mapImage: data.mapImage || null
                    }]);

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
            isRemoteUpdate.current = true;
            if (data.layers) {
                setLayers(data.layers);
            } else if (Array.isArray(data)) {
                // Fallback legacy support
                setLayers(prev => {
                    const l1 = prev.find(l => l.id === 1) || { id: 1, name: 'Layer 1', visible: true };
                    return [{ ...l1, units: data }, ...prev.filter(l => l.id !== 1)];
                });
            }
        });

        // Map update is layer specific now, but if we receive legacy map_update?
        // Assuming socket protocol update: 'layer_map_update' or 'map_update' updates active layer?
        // For simplicity, let's assume 'map_update' updates Layer 1 or Active Layer if legacy
        newSocket.on('map_update', (data) => {
            // To be refined: data needs to include layerId or we assume Layer 1
            console.log("Received map update (Legacy/Global)");
            // Legacy support: update Layer 1
            setLayers(prev => prev.map(l => l.id === 1 ? { ...l, mapImage: data } : l));
        });

        newSocket.on('config_update', (overrides) => {
            console.log("Received config update");
            if (overrides) {
                if (overrides.shipTypes) setShipTypes(overrides.shipTypes);
                if (overrides.shipClasses) setShipClasses(overrides.shipClasses);
                if (overrides.fleetTypes) setFleetTypes(overrides.fleetTypes);
                if (overrides.appSettings) setAppSettings(prev => ({ ...prev, ...overrides.appSettings }));
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
        if (!isServerSynced) return;
        if (isRemoteUpdate.current) {
            isRemoteUpdate.current = false;
            return;
        }
        if (isSpectator) return;

        // Emit local change (Send all layers)
        socket.emit('update_data', { sessionId, layers });
    }, [layers, socket, sessionId, isSpectator]);

    // --- Sync Map to Server (Legacy/Layer 1 assumption for now or disable?) ---
    // With layers, map data is inside layer. We should sync via update_data probably,
    // or if map is heavy, separate event. For now, let's keep separate event for active layer?
    // Complexity: Layer images are heavy. Sending all in update_data is bad.
    // Ideally: 'update_layer_map' { layerId, mapImage }
    // For now, let's skip automatic map sync until backend supports layer map.
    // OR: Sync Layer 1 map as global map for legacy compat.
    useEffect(() => {
        if (!socket || !sessionId) return;
        /* Legacy Map Sync Logic - Disabled for new Layer System for now, 
           or needs refactoring to sync specific layer images.
           Assuming update_data carries URLs, and binary blobs are handled via upload. 
        */
    }, [isSpectator]);


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

                // Load App Settings
                const savedSettings = localStorage.getItem('restia_app_settings');
                if (savedSettings) {
                    setAppSettings(JSON.parse(savedSettings));
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

    useEffect(() => {
        localStorage.setItem('restia_app_settings', JSON.stringify(appSettings));

        // Sync to server if host
        if (socket && sessionId && !isSpectator && isServerSynced) {
            // We debounce or just send? Settings change is rare, just send.
            // But we need to be careful not to loop if we receive update?
            // "config_update" handler sets state -> triggers this effect?
            // Yes. We need a way to distinguish.
            // However, config_update usually comes from OTHER clients (spectators don't send).
            // Host sends. Spectator receives. Spectator sets state -> triggers effect.
            // Spectator check is already here (if (!isSpectator)). Good.
            // Host sets state -> triggers effect -> Host sends. OK.
            // What if Host receives config_update? (from another Host/Editor?)
            // If multiple editors, yes loop is risk. But usually single host.
            // Let's rely on !isSpectator check for now assuming single host.
            socket.emit('update_config', { sessionId, overrides: { appSettings } });
        }
    }, [appSettings, socket, sessionId, isSpectator, isServerSynced]);

    // ファイル操作ハンドラ
    const handleFileUpload = async (e) => {
        if (isSpectator) return; // Disable for spectator
        const file = e.target.files[0];
        if (!file) return;
        if (file.name.endsWith('.zip')) {
            try {
                const data = await loadProject(file);
                setIsServerSynced(true);

                if (data.layers) {
                    setLayers(data.layers);
                    setActiveLayerId(data.activeLayerId || 1);
                } else {
                    // Legacy load
                    setLayers([{
                        id: 1, name: 'Layer 1', visible: true,
                        units: data.units || [],
                        mapImage: data.mapImage,
                        mapImageBlob: data.mapImageBlob
                    }]);
                }

                // Apply Config Overrides
                if (data.overrides) {
                    if (data.overrides.shipTypes) setShipTypes(data.overrides.shipTypes);
                    if (data.overrides.shipClasses) setShipClasses(data.overrides.shipClasses);
                    if (data.overrides.fleetTypes) setFleetTypes(data.overrides.fleetTypes);

                    // App Settings Override or Default
                    if (data.overrides.appSettings) {
                        setAppSettings(data.overrides.appSettings);
                    } else {
                        // Default if missing in ZIP
                        setAppSettings({ showFleetNameOnHover: true });
                    }

                    alert("設定ファイル(config)による上書き設定を適用しました。");

                    if (socket && sessionId && !isSpectator) {
                        socket.emit('update_config', { sessionId, overrides: data.overrides });
                    }
                }
            } catch (err) {
                console.error("Failed to load project:", err);
                alert("プロジェクトの読み込みに失敗しました");
            }
        } else if (file.type.startsWith('image/')) {
            // Updated behavior: Ask layer? or default to active.
            // MainScreen will handle specific uploads, but this is global handler.
            // Let's assume this updates Active Layer and we MUST use Base64 for sync.
            try {
                const base64 = await fileToBase64(file);
                setLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, mapImage: base64, mapImageBlob: file } : l));
            } catch (err) {
                console.error("Image conversion failed", err);
            }
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
                    layers={layers}
                    setLayers={setLayers}
                    activeLayerId={activeLayerId}
                    setActiveLayerId={setActiveLayerId}
                    // Legacy Props Compatibility
                    units={units}
                    setUnits={setUnits}
                    mapImage={currentMapImage}

                    onSwitchScreen={() => setCurrentScreen('edit')}
                    onOpenSettings={() => setCurrentScreen('settings')}
                    onOpenShipList={() => setCurrentScreen('shipList')}
                    onFileUpload={handleFileUpload}
                    onSaveZip={async () => {
                        try {
                            const overrides = {};
                            const hasChanged = (base, current) => JSON.stringify(base) !== JSON.stringify(current);


                            if (hasChanged(baseShipTypes, shipTypes)) overrides.shipTypes = shipTypes;
                            if (hasChanged(baseShipClasses, shipClasses)) overrides.shipClasses = shipClasses;
                            if (hasChanged(baseFleetTypes, fleetTypes)) overrides.fleetTypes = fleetTypes;
                            overrides.appSettings = appSettings; // Always save settings

                            await saveProject({ layers, activeLayerId, overrides });
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
                    appSettings={appSettings}
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
                    mapImage={currentMapImage}
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
                    appSettings={appSettings} setAppSettings={setAppSettings}
                    isSpectator={isSpectator}
                />
            ) : (
                <ShipListScreen
                    units={units}
                    setUnits={setUnits}
                    layers={layers} // Added
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