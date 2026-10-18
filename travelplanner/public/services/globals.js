// Expose the data and helpers to app.js as globals: the ones shared with the server, plus the browser-only ones.
import * as sharedData from "/shared/data.js";
import * as sharedGeo from "/shared/geo.js";
import * as data from "/data.js";
import * as geo from "/geo.js";
Object.assign(window, sharedData, sharedGeo, data, geo);
