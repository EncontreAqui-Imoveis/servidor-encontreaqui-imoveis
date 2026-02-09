"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const testDb_1 = require("../tests/helpers/testDb");
async function main() {
    try {
        console.log('Starting cleanDb...');
        await (0, testDb_1.cleanDb)();
        console.log('cleanDb finished successfully.');
    }
    catch (error) {
        console.error('cleanDb Failed:', error);
    }
    finally {
        await (0, testDb_1.closeDb)();
    }
}
main();
