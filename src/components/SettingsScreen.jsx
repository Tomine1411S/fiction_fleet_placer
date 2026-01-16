import React, { useState, useMemo } from 'react';

const SettingsScreen = ({
    onSwitchScreen,
    shipTypes, setShipTypes,
    shipClasses, setShipClasses,
    fleetTypes, setFleetTypes,
    fleetSuffixes, setFleetSuffixes, // New Props
    appSettings, setAppSettings // New Props
}) => {
    const [activeTab, setActiveTab] = useState('types'); // 'types', 'classes', 'fleets', 'suffixes', 'misc'

    // --- Duplicate Detection Logic ---
    const duplicateShipTypes = useMemo(() => {
        const counts = {};
        shipTypes.forEach(t => { if (t.ship_type_index) counts[t.ship_type_index] = (counts[t.ship_type_index] || 0) + 1; });
        return new Set(shipTypes.filter(t => counts[t.ship_type_index] > 1).map(t => t.ship_type_index));
    }, [shipTypes]);

    const duplicateShipClasses = useMemo(() => {
        const counts = {};
        shipClasses.forEach(c => { if (c.ship_class_index) counts[c.ship_class_index] = (counts[c.ship_class_index] || 0) + 1; });
        return new Set(shipClasses.filter(c => counts[c.ship_class_index] > 1).map(c => c.ship_class_index));
    }, [shipClasses]);

    const duplicateFleetTypes = useMemo(() => {
        const counts = {};
        fleetTypes.forEach(f => { if (f.type) counts[f.type] = (counts[f.type] || 0) + 1; });
        return new Set(fleetTypes.filter(f => counts[f.type] > 1).map(f => f.type));
    }, [fleetTypes]);

    const duplicateFleetSuffixes = useMemo(() => {
        const counts = {};
        (fleetSuffixes || []).forEach(s => { if (s.suffix) counts[s.suffix] = (counts[s.suffix] || 0) + 1; });
        return new Set((fleetSuffixes || []).filter(s => counts[s.suffix] > 1).map(s => s.suffix));
    }, [fleetSuffixes]);

    // --- Import / Export Handlers ---
    const handleExport = () => {
        const data = {
            shipTypes,
            shipClasses,
            fleetTypes,
            fleetSuffixes
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `restia_config_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleImport = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                if (data.shipTypes) setShipTypes(data.shipTypes);
                if (data.shipClasses) setShipClasses(data.shipClasses);
                if (data.shipClasses) setShipClasses(data.shipClasses);
                if (data.fleetTypes) setFleetTypes(data.fleetTypes);
                if (data.fleetSuffixes) setFleetSuffixes(data.fleetSuffixes);
                alert("設定をインポートしました。");
            } catch (err) {
                console.error(err);
                alert("インポートに失敗しました。ファイル形式を確認してください。");
            }
        };
        reader.readAsText(file);
    };

    // --- UI Components for Tables ---
    // Shared styles
    const tableStyle = { width: '100%', borderCollapse: 'collapse', marginTop: '10px' };
    const thStyle = { border: '1px solid #ccc', padding: '8px', background: '#f0f0f0', textAlign: 'left' };
    const tdStyle = { border: '1px solid #ccc', padding: '8px' };
    const inputStyle = { width: '100%', padding: '4px', boxSizing: 'border-box' };

    // --- Ship Types Editor ---
    const renderShipTypesEditor = () => {
        const addRow = () => {
            setShipTypes([...shipTypes, { ship_type_index: '', name_of_type: '' }]);
        };
        const updateRow = (index, field, value) => {
            const newTypes = [...shipTypes];
            newTypes[index][field] = value;
            setShipTypes(newTypes);
        };
        const deleteRow = (index) => {
            if (window.confirm("削除しますか？")) {
                setShipTypes(shipTypes.filter((_, i) => i !== index));
            }
        };

        return (
            <div>
                <h3>艦種設定 (Ship Types)</h3>
                <p style={{ fontSize: '0.9em', color: '#666' }}>例: DD (駆逐艦), CL (軽巡洋艦)</p>
                <table style={tableStyle}>
                    <thead>
                        <tr>
                            <th style={thStyle}>Type Code (ID)</th>
                            <th style={thStyle}>Display Name</th>
                            <th style={{ ...thStyle, width: '60px' }}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {shipTypes.map((t, i) => {
                            const isDup = duplicateShipTypes.has(t.ship_type_index);
                            return (
                                <tr key={i} style={{ background: isDup ? '#fff0f0' : 'transparent' }}>
                                    <td style={tdStyle}>
                                        <input
                                            value={t.ship_type_index}
                                            onChange={(e) => updateRow(i, 'ship_type_index', e.target.value)}
                                            style={{ ...inputStyle, borderColor: isDup ? 'red' : '' }}
                                            placeholder="ex. DD"
                                        />
                                        {isDup && <div style={{ color: 'red', fontSize: '0.8em' }}>重複しています</div>}
                                    </td>
                                    <td style={tdStyle}>
                                        <input
                                            value={t.name_of_type}
                                            onChange={(e) => updateRow(i, 'name_of_type', e.target.value)}
                                            style={inputStyle}
                                            placeholder="ex. 駆逐艦"
                                        />
                                    </td>
                                    <td style={tdStyle}>
                                        <button onClick={() => deleteRow(i)} style={{ color: 'red' }}>×</button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                <button onClick={addRow} style={{ marginTop: '10px' }}>+ 追加</button>
            </div>
        );
    };

    // --- Ship Classes Editor ---
    const renderShipClassesEditor = () => {
        const addRow = () => {
            setShipClasses([...shipClasses, { ship_type_index: '', ship_class_index: '', ship_class_name: '' }]);
        };
        const updateRow = (index, field, value) => {
            const newClasses = [...shipClasses];
            newClasses[index][field] = value;
            setShipClasses(newClasses);
        };
        const deleteRow = (index) => {
            if (window.confirm("削除しますか？")) {
                setShipClasses(shipClasses.filter((_, i) => i !== index));
            }
        };

        return (
            <div>
                <h3>艦型設定 (Ship Classes)</h3>
                <p style={{ fontSize: '0.9em', color: '#666' }}>親となる艦種(Type)と紐づけて定義します。</p>
                <table style={tableStyle}>
                    <thead>
                        <tr>
                            <th style={thStyle}>Parent Type</th>
                            <th style={thStyle}>Class Code</th>
                            <th style={thStyle}>Class Name</th>
                            <th style={{ ...thStyle, width: '60px' }}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {shipClasses.map((c, i) => {
                            const isDup = duplicateShipClasses.has(c.ship_class_index);
                            return (
                                <tr key={i} style={{ background: isDup ? '#fff0f0' : 'transparent' }}>
                                    <td style={tdStyle}>
                                        <select
                                            value={c.ship_type_index}
                                            onChange={(e) => updateRow(i, 'ship_type_index', e.target.value)}
                                            style={{ width: '100%' }}
                                        >
                                            <option value="">(Select Type)</option>
                                            {shipTypes.map(t => (
                                                <option key={t.ship_type_index} value={t.ship_type_index}>
                                                    {t.ship_type_index} ({t.name_of_type})
                                                </option>
                                            ))}
                                        </select>
                                    </td>
                                    <td style={tdStyle}>
                                        <input
                                            value={c.ship_class_index}
                                            onChange={(e) => updateRow(i, 'ship_class_index', e.target.value)}
                                            style={{ ...inputStyle, borderColor: isDup ? 'red' : '' }}
                                            placeholder="ex. HM"
                                        />
                                        {isDup && <div style={{ color: 'red', fontSize: '0.8em' }}>重複しています</div>}
                                    </td>
                                    <td style={tdStyle}>
                                        <input
                                            value={c.ship_class_name}
                                            onChange={(e) => updateRow(i, 'ship_class_name', e.target.value)}
                                            style={inputStyle}
                                            placeholder="ex. ふみづき型"
                                        />
                                    </td>
                                    <td style={tdStyle}>
                                        <button onClick={() => deleteRow(i)} style={{ color: 'red' }}>×</button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                <button onClick={addRow} style={{ marginTop: '10px' }}>+ 追加</button>
            </div>
        );
    };

    // --- Fleet Types Editor ---
    const renderFleetTypesEditor = () => {
        const addRow = () => {
            setFleetTypes([...fleetTypes, { type: '', name_of_fleet: '' }]);
        };
        const updateRow = (index, field, value) => {
            const newTypes = [...fleetTypes];
            newTypes[index][field] = value;
            setFleetTypes(newTypes);
        };
        const deleteRow = (index) => {
            if (window.confirm("削除しますか？")) {
                setFleetTypes(fleetTypes.filter((_, i) => i !== index));
            }
        };

        return (
            <div>
                <h3>部隊種別設定 (Fleet Types)</h3>
                <p style={{ fontSize: '0.9em', color: '#666' }}>部隊コードの自動命名ルールに使用されます。</p>
                <table style={tableStyle}>
                    <thead>
                        <tr>
                            <th style={thStyle}>Type Code</th>
                            <th style={thStyle}>Name Suffix</th>
                            <th style={{ ...thStyle, width: '60px' }}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {fleetTypes.map((t, i) => {
                            const isDup = duplicateFleetTypes.has(t.type);
                            return (
                                <tr key={i} style={{ background: isDup ? '#fff0f0' : 'transparent' }}>
                                    <td style={tdStyle}>
                                        <input
                                            value={t.type}
                                            onChange={(e) => updateRow(i, 'type', e.target.value)}
                                            style={{ ...inputStyle, borderColor: isDup ? 'red' : '' }}
                                            placeholder="ex. D"
                                        />
                                        {isDup && <div style={{ color: 'red', fontSize: '0.8em' }}>重複しています</div>}
                                    </td>
                                    <td style={tdStyle}>
                                        <input
                                            value={t.name_of_fleet}
                                            onChange={(e) => updateRow(i, 'name_of_fleet', e.target.value)}
                                            style={inputStyle}
                                            placeholder="ex. 駆逐隊"
                                        />
                                    </td>
                                    <td style={tdStyle}>
                                        <button onClick={() => deleteRow(i)} style={{ color: 'red' }}>×</button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                <button onClick={addRow} style={{ marginTop: '10px' }}>+ 追加</button>
            </div>
        );
    };

    // --- Fleet Suffixes Editor ---
    const renderFleetSuffixesEditor = () => {
        const safeSuffixes = fleetSuffixes || [];
        const addRow = () => {
            setFleetSuffixes([...safeSuffixes, { suffix: '.', format: '{number}{type}' }]);
        };
        const updateRow = (index, field, value) => {
            const newSuffixes = [...safeSuffixes];
            newSuffixes[index][field] = value;
            setFleetSuffixes(newSuffixes);
        };
        const deleteRow = (index) => {
            if (window.confirm("削除しますか？")) {
                setFleetSuffixes(safeSuffixes.filter((_, i) => i !== index));
            }
        };

        return (
            <div>
                <h3>部隊コード形式 (Fleet Format)</h3>
                <p style={{ fontSize: '0.9em', color: '#666' }}>
                    末尾記号(Suffix)ごとの部隊名変換ルールを設定します。<br />
                    Format内の <code>{'{number}'}</code> は番号、<code>{'{type}'}</code> は部隊種別名(Fleet Type Name)に置換されます。
                </p>
                <table style={tableStyle}>
                    <thead>
                        <tr>
                            <th style={thStyle}>Suffix (Match)</th>
                            <th style={thStyle}>Name Format</th>
                            <th style={{ ...thStyle, width: '60px' }}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {safeSuffixes.map((s, i) => {
                            const isDup = duplicateFleetSuffixes.has(s.suffix);
                            return (
                                <tr key={i} style={{ background: isDup ? '#fff0f0' : 'transparent' }}>
                                    <td style={tdStyle}>
                                        <input
                                            value={s.suffix}
                                            onChange={(e) => updateRow(i, 'suffix', e.target.value)}
                                            style={{ ...inputStyle, borderColor: isDup ? 'red' : '' }}
                                            placeholder="ex. Sq."
                                        />
                                        {isDup && <div style={{ color: 'red', fontSize: '0.8em' }}>重複しています</div>}
                                    </td>
                                    <td style={tdStyle}>
                                        <input
                                            value={s.format}
                                            onChange={(e) => updateRow(i, 'format', e.target.value)}
                                            style={inputStyle}
                                            placeholder="ex. {number}{type}隊"
                                        />
                                    </td>
                                    <td style={tdStyle}>
                                        <button onClick={() => deleteRow(i)} style={{ color: 'red' }}>×</button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                <button onClick={addRow} style={{ marginTop: '10px' }}>+ 追加</button>
            </div>
        );
    };

    // --- Misc / App Settings Editor ---
    const renderMiscEditor = () => {
        return (
            <div>
                <h3>その他設定 (App Settings)</h3>
                <div style={{ marginTop: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', marginBottom: '10px' }}>
                        <input
                            type="checkbox"
                            checked={appSettings?.autoConvertFleetName ?? true}
                            onChange={(e) => setAppSettings({ ...appSettings, autoConvertFleetName: e.target.checked })}
                            style={{ transform: 'scale(1.2)' }}
                        />
                        <span>
                            <strong>部隊名の自動変換を有効にする (Auto-convert Fleet Name)</strong>
                            <div style={{ fontSize: '0.9em', color: '#666' }}>
                                部隊コード入力時に名称を自動入力します。
                            </div>
                        </span>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={appSettings?.showFleetNameOnHover ?? true}
                            onChange={(e) => setAppSettings({ ...appSettings, showFleetNameOnHover: e.target.checked })}
                            style={{ transform: 'scale(1.2)' }}
                        />
                        <span>
                            <strong>マウスオーバー時に部隊名を表示する</strong>
                            <div style={{ fontSize: '0.9em', color: '#666', marginTop: '2px' }}>
                                (Show Fleet Name on Hover) - 初期値: ON
                            </div>
                        </span>
                    </label>
                </div>

                <div style={{ marginTop: '20px', borderTop: '1px solid #eee', paddingTop: '10px' }}>
                    <h4 style={{ margin: '0 0 10px 0' }}>子レイヤー作成時の部隊配置 (Child Layer Creation)</h4>
                    <div style={{ display: 'flex', gap: '20px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
                            <input
                                type="radio"
                                name="childPlacementMode"
                                checked={(appSettings?.childPlacementMode || 'split') === 'split'}
                                onChange={() => setAppSettings({ ...appSettings, childPlacementMode: 'split' })}
                            />
                            <span>
                                <strong>艦隊単位で分割 (Split)</strong>
                                <div style={{ fontSize: '0.8em', color: '#666' }}>
                                    複合ピンを展開して個別に配置します。
                                </div>
                            </span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
                            <input
                                type="radio"
                                name="childPlacementMode"
                                checked={appSettings?.childPlacementMode === 'grouped'}
                                onChange={() => setAppSettings({ ...appSettings, childPlacementMode: 'grouped' })}
                            />
                            <span>
                                <strong>構成を維持 (Grouped)</strong>
                                <div style={{ fontSize: '0.8em', color: '#666' }}>
                                    親レイヤーのピン構成を維持します。
                                </div>
                            </span>
                        </label>
                    </div>
                </div>

                <div style={{ marginTop: '20px', borderTop: '1px solid #eee', paddingTop: '10px' }}>
                    <h4 style={{ margin: '0 0 10px 0' }}>リンクピンの表示形式 (Link Pin Tooltip)</h4>
                    <div style={{ display: 'flex', gap: '20px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
                            <input
                                type="radio"
                                name="linkPinTooltipMode"
                                checked={(appSettings?.linkPinTooltipMode || 'flat') === 'flat'}
                                onChange={() => setAppSettings({ ...appSettings, linkPinTooltipMode: 'flat' })}
                            />
                            <span>
                                <strong>艦隊一覧 (Flat)</strong>
                                <div style={{ fontSize: '0.8em', color: '#666' }}>
                                    子レイヤー内の全艦隊をリスト表示します。
                                </div>
                            </span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
                            <input
                                type="radio"
                                name="linkPinTooltipMode"
                                checked={appSettings?.linkPinTooltipMode === 'grouped'}
                                onChange={() => setAppSettings({ ...appSettings, linkPinTooltipMode: 'grouped' })}
                            />
                            <span>
                                <strong>ピン別 (Grouped)</strong>
                                <div style={{ fontSize: '0.8em', color: '#666' }}>
                                    子レイヤー内のピンごとにグループ化して表示します。
                                </div>
                            </span>
                        </label>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="screen settings-screen" style={{ flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
            <div className="toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', flexShrink: 0 }}>
                <button className="btn" onClick={onSwitchScreen}>＜ マップ画面へ戻る</button>
                <h2>設定画面</h2>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <label className="btn">
                        📥 インポート
                        <input type="file" accept=".json" hidden onChange={handleImport} />
                    </label>
                    <button className="btn" onClick={handleExport}>
                        📤 エクスポート
                    </button>
                </div>
            </div>

            <div className="settings-content" style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
                <div className="tabs" style={{ marginBottom: '20px', borderBottom: '1px solid #ccc' }}>
                    <button
                        onClick={() => setActiveTab('types')}
                        style={{ padding: '10px 20px', background: activeTab === 'types' ? '#ddd' : 'transparent', border: 'none', borderBottom: activeTab === 'types' ? '2px solid black' : 'none', cursor: 'pointer', fontSize: '16px' }}
                    >
                        艦種 (Types) {duplicateShipTypes.size > 0 && <span style={{ color: 'red', fontWeight: 'bold' }}> (!)</span>}
                    </button>
                    <button
                        onClick={() => setActiveTab('classes')}
                        style={{ padding: '10px 20px', background: activeTab === 'classes' ? '#ddd' : 'transparent', border: 'none', borderBottom: activeTab === 'classes' ? '2px solid black' : 'none', cursor: 'pointer', fontSize: '16px' }}
                    >
                        艦型 (Classes) {duplicateShipClasses.size > 0 && <span style={{ color: 'red', fontWeight: 'bold' }}> (!)</span>}
                    </button>
                    <button
                        onClick={() => setActiveTab('fleets')}
                        style={{ padding: '10px 20px', background: activeTab === 'fleets' ? '#ddd' : 'transparent', border: 'none', borderBottom: activeTab === 'fleets' ? '2px solid black' : 'none', cursor: 'pointer', fontSize: '16px' }}
                    >
                        部隊種別 (Fleet Types) {duplicateFleetTypes.size > 0 && <span style={{ color: 'red', fontWeight: 'bold' }}> (!)</span>}
                    </button>
                    <button
                        onClick={() => setActiveTab('suffixes')}
                        style={{ padding: '10px 20px', background: activeTab === 'suffixes' ? '#ddd' : 'transparent', border: 'none', borderBottom: activeTab === 'suffixes' ? '2px solid black' : 'none', cursor: 'pointer', fontSize: '16px' }}
                    >
                        コード形式 (Suffixes) {duplicateFleetSuffixes.size > 0 && <span style={{ color: 'red', fontWeight: 'bold' }}> (!)</span>}
                    </button>
                    <button
                        onClick={() => setActiveTab('misc')}
                        style={{ padding: '10px 20px', background: activeTab === 'misc' ? '#ddd' : 'transparent', border: 'none', borderBottom: activeTab === 'misc' ? '2px solid black' : 'none', cursor: 'pointer', fontSize: '16px' }}
                    >
                        その他 (Misc)
                    </button>
                </div>

                <div className="tab-content" style={{ marginBottom: '50px' }}>
                    {activeTab === 'types' && renderShipTypesEditor()}
                    {activeTab === 'classes' && renderShipClassesEditor()}
                    {activeTab === 'fleets' && renderFleetTypesEditor()}
                    {activeTab === 'suffixes' && renderFleetSuffixesEditor()}
                    {activeTab === 'misc' && renderMiscEditor()}
                </div>
            </div>
        </div>
    );
};

export default SettingsScreen;
