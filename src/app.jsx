import React, { useState, useEffect, useRef } from 'react';
import MainScreen from './components/MainScreen';
import EditScreen from './components/EditScreen';
import SettingsScreen from './components/SettingsScreen';
import ShipListScreen from './components/ShipListScreen';
import { saveProject, loadProject, generateStatusReport } from './utils/fileSystem';
import FleetSplitScreen from './components/FleetSplitScreen';
import { loadCSV } from './utils/csvLoader';
import { io } from 'socket.io-client';
import './App.css'; // スタイル定義が必要

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
    const [isSpectator, setIsSpectator] = useState(false);
    const [socket, setSocket] = useState(null);
    const isRemoteUpdate = useRef(false); // Ref to prevents echo loops
    const isRemoteMapUpdate = useRef(false);

    // Master Data State (Lifted from EditScreen)
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
        const socketUrl = window.location.hostname === 'localhost' ? 'http://localhost:3001' : `http://${window.location.hostname}:3001`;

        console.log("Connecting to socket:", socketUrl);
        const newSocket = io(socketUrl);
        setSocket(newSocket);

        newSocket.on('connect', () => {
            console.log("Connected to server");
            newSocket.emit('join_session', sId);
        });

        newSocket.on('init_data', (data) => {
            if (data) {
                console.log("Received init data");
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

        return () => {
            newSocket.disconnect();
        };
    }, []);

    // --- Sync Updates to Server ---
    useEffect(() => {
        if (!socket || !sessionId) return;

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
                setUnits(data.units || []);
                if (data.mapImage) {
                    setMapImage(data.mapImage);
                    setMapImageBlob(data.mapImageBlob);
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
                            await saveProject({ units, mapImageBlob });
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