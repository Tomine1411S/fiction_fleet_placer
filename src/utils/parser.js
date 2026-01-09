export const parseUnitCode = (str) => {
    // 例: 031DSq. -> 031, D
    // 例: 1032TSq. -> 1032, T
    const regex = /^(\d{3,4})([A-Z]{1,2})Sq\.$/;
    const match = str.match(regex);
    if (!match) return null;
    return {
        full: str,
        number: match[1],
        typeCode: match[2]
    };
};

export const parseShipString = (str) => {
    // 例: DD-HM01 ふみづき
    // Regex: ^([A-Z]+)-([A-Z0-9]+)(\d+)\s+(.+)$
    const regex = /^([A-Z]+)-([A-Z0-9]+)(\d+)\s+(.+)$/;
    const match = str.match(regex);
    if (!match) {
        // フォールバック: 単純なスペース分割など、あるいは空を返す
        // ここではnullを返し、呼び出し元でハンドリングさせる
        return null;
    }
    return {
        type: match[1],
        classCode: match[2],
        number: match[3],
        name: match[4]
    };
};

export const formatShipString = (ship) => {
    if (!ship || !ship.type) return "";
    return `${ship.type}-${ship.classCode}${ship.number} ${ship.name}`;
};
