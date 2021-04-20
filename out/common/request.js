import * as os from 'os';
const { EOL } = os;
import * as fs from 'fs';
import * as path from 'path';
import { pickBy, identity, isEmpty } from 'lodash';
import { logDebug, formatURL, NAME } from './common';
import * as vscode from 'vscode';
import { Method } from './httpConstants';
import { attemptToLoadVariable } from './cache';
export class RequestParser {
    constructor(query) {
        var _a;
        let linesOfRequest = query.split(EOL);
        if (linesOfRequest.filter(s => { return s; }).length === 0) {
            throw new Error('Please provide request information (at minimum a URL) before running the cell!');
        }
        logDebug(linesOfRequest);
        this.originalRequest = linesOfRequest;
        this.variableName = this._parseVariableName();
        this.requestOptions = {
            method: this._parseMethod(),
            baseURL: this._parseBaseUrl(),
            timeout: 1000
        };
        this.requestOptions.params = this._parseQueryParams();
        // eslint-disable-next-line @typescript-eslint/naming-convention
        let defaultHeaders = { "User-Agent": NAME };
        this.requestOptions.headers = (_a = this._parseHeaders()) !== null && _a !== void 0 ? _a : defaultHeaders;
        this.requestOptions.data = this._parseBody();
    }
    getRequest() {
        return pickBy(this.requestOptions, identity);
    }
    getBaseUrl() {
        return this.baseUrl;
    }
    getVariableName() {
        return this.variableName;
    }
    _parseVariableName() {
        let firstLine = this.originalRequest[0].trimLeft();
        if (!firstLine.startsWith('let ')) {
            return undefined;
        }
        let endIndexOfVarName = firstLine.indexOf('=') + 1;
        let varDeclaration = firstLine.substring(0, endIndexOfVarName);
        let variableName = varDeclaration.replace('let ', '');
        variableName = variableName.replace('=', '');
        variableName = variableName.trim();
        if (variableName.includes(' ')) {
            throw new Error('Invalid declaration of variable!');
        }
        return variableName;
    }
    _stripVariableDeclaration() {
        let firstLine = this.originalRequest[0].trimLeft();
        if (!firstLine.startsWith('let ')) {
            return firstLine;
        }
        let endIndexOfVarName = firstLine.indexOf('=') + 1;
        return firstLine.substring(endIndexOfVarName).trim();
    }
    _parseMethod() {
        const tokens = this._stripVariableDeclaration().split(/[\s,]+/);
        if (tokens.length === 0) {
            throw new Error('Invalid request!');
        }
        if (tokens.length === 1) {
            return Method.get;
        }
        if (!(tokens[0].toLowerCase() in Method)) {
            throw new Error('Invalid method given!');
        }
        return Method[tokens[0].toLowerCase()];
    }
    _parseBaseUrl() {
        const tokens = this._stripVariableDeclaration().split(/[\s,]+/);
        if (tokens.length === 0) {
            throw new Error('Invalid request!');
        }
        if (tokens.length === 1) {
            let url = tokens[0].split('?')[0];
            this.baseUrl = url;
            return formatURL(url);
        }
        else if (tokens.length === 2) {
            let url = tokens[1].split('?')[0];
            this.baseUrl = url;
            return formatURL(url);
        }
        throw new Error('Invalid URL given!');
    }
    _parseQueryParams() {
        let queryInUrl = this._stripVariableDeclaration().split('?')[1];
        let strParams = queryInUrl ? queryInUrl.split('&') : [];
        if (this.originalRequest.length >= 2) {
            let i = 1;
            while (i < this.originalRequest.length &&
                (this.originalRequest[i].trim().startsWith('?') ||
                    this.originalRequest[i].trim().startsWith('&'))) {
                strParams.push(this.originalRequest[i].trim().substring(1));
                i++;
            }
        }
        if (strParams.length === 0) {
            return undefined;
        }
        let params = {};
        for (const p of strParams) {
            let parts = p.split('=');
            if (parts.length !== 2) {
                throw new Error(`Invalid query paramter for ${p}`);
            }
            let loadedFromVariable = attemptToLoadVariable(parts[1]);
            if (loadedFromVariable) {
                if (typeof loadedFromVariable === 'string') {
                    params[parts[0]] = loadedFromVariable;
                }
                else {
                    params[parts[0]] = JSON.stringify(loadedFromVariable);
                }
            }
            else {
                params[parts[0]] = parts[1];
            }
            // TODO clean value to raw form?
        }
        return params;
    }
    _parseHeaders() {
        if (this.originalRequest.length < 2) {
            return undefined;
        }
        let i = 1;
        while (i < this.originalRequest.length &&
            (this.originalRequest[i].trim().startsWith('?') ||
                this.originalRequest[i].trim().startsWith('&'))) {
            i++;
        }
        if (i >= this.originalRequest.length) {
            return undefined;
        }
        let headers = {};
        while (i < this.originalRequest.length && this.originalRequest[i]) {
            let h = this.originalRequest[i];
            let parts = h.split(/(:\s+)/).filter(s => { return !s.match(/(:\s+)/); });
            if (parts.length !== 2) {
                throw new Error(`Invalid header ${h}`);
            }
            let loadedFromVariable = attemptToLoadVariable(parts[1]);
            if (loadedFromVariable) {
                if (typeof loadedFromVariable === 'string') {
                    headers[parts[0]] = loadedFromVariable;
                }
                else {
                    headers[parts[0]] = JSON.stringify(loadedFromVariable);
                }
            }
            else {
                headers[parts[0]] = parts[1];
            }
            i++;
        }
        return isEmpty(headers) ? undefined : headers;
    }
    _parseBody() {
        if (this.originalRequest.length < 3) {
            return undefined;
        }
        let i = 0;
        while (i < this.originalRequest.length && this.originalRequest[i]) {
            i++;
        }
        i++;
        let bodyStr = this.originalRequest.slice(i).join('\n');
        let fileContents = this._attemptToLoadFile(bodyStr);
        if (fileContents) {
            return fileContents;
        }
        let variableContents = attemptToLoadVariable(bodyStr);
        if (variableContents) {
            return variableContents;
        }
        try {
            let bodyObj = JSON.parse(bodyStr);
            // attemptToLoadVariableInObject(bodyObj); // TODO problems parsing body when given var name without quotes
            return bodyObj;
        }
        catch (e) {
            return bodyStr;
        }
    }
    _attemptToLoadFile(possibleFilePath) {
        var _a, _b;
        try {
            const workSpaceDir = path.dirname((_b = (_a = vscode.window.activeTextEditor) === null || _a === void 0 ? void 0 : _a.document.uri.fsPath) !== null && _b !== void 0 ? _b : '');
            if (!workSpaceDir) {
                return;
            }
            const absolutePath = path.join(workSpaceDir, possibleFilePath);
            return fs.readFileSync(absolutePath).toString();
        }
        catch (error) {
            // File doesn't exist
        }
        return;
    }
}
//# sourceMappingURL=request.js.map