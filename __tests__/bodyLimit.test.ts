import { enforceBodySize, requireJson } from '../lib/bodyLimit';

/** Create a minimal mock NextApiRequest */
function mockReq(headers: Record<string, string> = {}): any {
  return { headers };
}

/** Create a minimal mock NextApiResponse */
function mockRes() {
  const res: any = {
    _status: 0,
    _body: null,
    status(code: number) { res._status = code; return res; },
    json(body: any) { res._body = body; return res; },
    setHeader() {},
  };
  return res;
}

// ---------------------------------------------------------------------------
// enforceBodySize
// ---------------------------------------------------------------------------
describe('enforceBodySize', () => {
  it('returns true when content-length is under the limit', () => {
    const req = mockReq({ 'content-length': '100' });
    const res = mockRes();
    expect(enforceBodySize(req, res, 1024)).toBe(true);
    expect(res._status).toBe(0); // no response sent
  });

  it('returns false and sends 413 when content-length exceeds limit', () => {
    const req = mockReq({ 'content-length': '2000000' });
    const res = mockRes();
    expect(enforceBodySize(req, res, 1048576)).toBe(false);
    expect(res._status).toBe(413);
    expect(res._body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns true when content-length header is missing', () => {
    const req = mockReq({});
    const res = mockRes();
    expect(enforceBodySize(req, res, 1024)).toBe(true);
  });

  it('returns true when exactly at the limit', () => {
    const req = mockReq({ 'content-length': '1024' });
    const res = mockRes();
    expect(enforceBodySize(req, res, 1024)).toBe(true);
  });

  it('returns true for non-numeric content-length', () => {
    const req = mockReq({ 'content-length': 'abc' });
    const res = mockRes();
    expect(enforceBodySize(req, res, 1024)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// requireJson
// ---------------------------------------------------------------------------
describe('requireJson', () => {
  it('returns true for application/json', () => {
    const req = mockReq({ 'content-type': 'application/json' });
    const res = mockRes();
    expect(requireJson(req, res)).toBe(true);
    expect(res._status).toBe(0);
  });

  it('returns true for application/json with charset', () => {
    const req = mockReq({ 'content-type': 'application/json; charset=utf-8' });
    const res = mockRes();
    expect(requireJson(req, res)).toBe(true);
  });

  it('returns false and sends 400 for text/plain', () => {
    const req = mockReq({ 'content-type': 'text/plain' });
    const res = mockRes();
    expect(requireJson(req, res)).toBe(false);
    expect(res._status).toBe(400);
    expect(res._body.code).toBe('INVALID_CONTENT_TYPE');
  });

  it('returns false when content-type is missing', () => {
    const req = mockReq({});
    const res = mockRes();
    expect(requireJson(req, res)).toBe(false);
    expect(res._status).toBe(400);
  });

  it('returns false for multipart/form-data', () => {
    const req = mockReq({ 'content-type': 'multipart/form-data' });
    const res = mockRes();
    expect(requireJson(req, res)).toBe(false);
  });
});
