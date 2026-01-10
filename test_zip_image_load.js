
import JSZip from 'jszip';
import fs from 'fs';

// Mock Browser globals if needed, or just run in node
// We need to simulate the save and load logic.

async function testFleetImageRoundTrip() {
    console.log("Starting test...");
    const zip = new JSZip();

    // 1. Simulate Saving
    const pinNum = 1;
    const fleetNum = 1;
    const mockBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGP6DwABBAEAAAAA"; // 1x1 pixel

    // Structure as per saveProject
    const pinDir = zip.folder(`fleet/pin${pinNum}`);
    pinDir.file("pin_info.txt", "Pos:100,100\nType:fleet");

    const fleetDir = pinDir.folder(`fleet${fleetNum}`);
    fleetDir.file("fleet_index.txt", "Code:123\nName:TestFleet");

    // IMPORTANT: Saving image at root image/ folder
    zip.file(`image/pin${pinNum}/fleet${fleetNum}.png`, mockBase64, { base64: true });

    // Test Case 2: Implicit folders (Mimic "No Dir Entry")
    // Note: JSZip might auto-create dirs?
    // We can try to manually remove dir entries if JSZip exposes them?
    // Or just rely on the fact that file() doesn't necessarily create dir entry for inspection.
    zip.file(`fleet/pin2/pin_info.txt`, "Pos:200,200\nType:fleet");
    zip.file(`fleet/pin2/fleet1/fleet_index.txt`, "Code:456");
    zip.file(`image/pin2/fleet1.png`, mockBase64, { base64: true });

    console.log("Mock ZIP created. Files:");
    zip.forEach((path, file) => console.log(" - " + path));

    // 2. Simulate Loading (Copying logic from fileSystem.js loadProject)
    // We can't import fileSystem.js easily because it uses ES modules and browser-specifics.
    // So we copy the pivotal logic here to reproduce the bug.

    const pinFolders = new Set();
    zip.forEach((relativePath, zipEntry) => {
        const match = relativePath.match(/^fleet\/pin(\d+)\/$/);
        if (match && zipEntry.dir) {
            pinFolders.add(match[1]);
        }
    });

    console.log("Found pins:", Array.from(pinFolders));

    for (const pinIdStr of pinFolders) {
        const pinDirPath = `fleet/pin${pinIdStr}/`;

        // Find fleets
        const fleetFolders = [];
        zip.forEach((relativePath, zipEntry) => {
            // Logic from fileSystem.js
            if (relativePath.startsWith(pinDirPath) && zipEntry.dir) {
                // Regex: ^fleet/pin1/fleet(\d+)/$
                // Note: regex in fileSystem.js code: new RegExp(`^${pinDir}fleet(\\d+)\/$`)
                // Let's replicate exact regex construction
                const regex = new RegExp(`^${pinDirPath}fleet(\\d+)\/$`); // Removed escape for slash slightly different in string?
                // fileSystem.js: new RegExp(`^${pinDir}fleet(\\d+)\/$`)  <- Backslash before slash might be stripped if not double escaped in string?
                // In fileSystem.js source: `^${pinDir}fleet(\\d+)\/$`

                const match = relativePath.match(regex);
                if (match) fleetFolders.push(match[1]);
            }
        });

        console.log(`Found fleets for pin ${pinIdStr}:`, fleetFolders);

        for (const fleetIdStr of fleetFolders) {
            // Attempt to load image
            const imgPath = `image/pin${pinIdStr}/fleet${fleetIdStr}.png`;
            const imgFile = zip.file(imgPath);

            if (imgFile) {
                console.log(`[SUCCESS] Found image at ${imgPath}`);
                const b64 = await imgFile.async("base64");
                console.log(`[data] Loaded base64 length: ${b64.length}`);
            } else {
                console.error(`[FAIL] Could not find image at ${imgPath}`);
            }
        }
    }
}

testFleetImageRoundTrip().catch(console.error);
