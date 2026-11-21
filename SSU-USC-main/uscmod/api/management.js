"use strict";
const { createManagementHTTPHandler } = require("../server/http.cjs");
const { getRuntime } = require("../server/runtime.cjs");
module.exports = createManagementHTTPHandler({ getRuntime });
