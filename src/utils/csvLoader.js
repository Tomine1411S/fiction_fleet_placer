
export const loadCSV = async (path) => {
    try {
        const response = await fetch(path);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const text = await response.text();
        const lines = text.split('\n').map(line => line.trim()).filter(line => line);
        if (lines.length === 0) return [];

        const headers = lines[0].split(',').map(h => h.trim());
        const data = lines.slice(1).map(line => {
            // Basic CSV split, considering potential quoted values? 
            // The simple split(',') is risky if values contain commas. 
            // But User's example data seems simple. 
            // Implementing a slightly more robust regex split if needed, 
            // but for now simple split is likely sufficient given the provided sample.
            const values = line.split(',').map(v => v.trim());
            const obj = {};
            headers.forEach((header, i) => {
                obj[header] = values[i] || ''; // Handle missing trailing values
            });
            return obj;
        });
        return data;
    } catch (error) {
        console.error("Failed to load CSV form path:", path, error);
        return [];
    }
};
