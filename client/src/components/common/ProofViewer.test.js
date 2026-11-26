import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import ProofViewer from './ProofViewer';

global.IS_REACT_ACT_ENVIRONMENT = true;
let host, root, getBlob, open, clickLink, downloaded;
const proof = {id:77, receipt_file_name:'Synthetic bank proof.pdf'};
const button = name => Array.from(host.querySelectorAll('button')).find(item => item.textContent === name);
const click = name => act(async () => button(name).click());
const render = props => act(async () => root.render(<ProofViewer proof={proof} getBlob={getBlob} {...props}/>));
const newTab = () => ({opener:{}, closed:false, close:jest.fn(), location:{replace:jest.fn()}});
beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  getBlob = jest.fn().mockResolvedValue(new Blob(['%PDF-1.4'], {type:'application/pdf'}));
  URL.createObjectURL = jest.fn(() => 'blob:synthetic-private-proof'); URL.revokeObjectURL = jest.fn();
  open = jest.spyOn(window,'open');
  clickLink = jest.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function () {downloaded = {name:this.download, url:this.href};});
});
afterEach(async () => {await act(async () => root.unmount()); host.remove(); jest.restoreAllMocks();});

test('PDF preview uses authenticated bytes and permits the native browser PDF viewer', async () => {
  await render(); expect(getBlob).not.toHaveBeenCalled(); await click('View proof');
  expect(getBlob).toHaveBeenCalledWith('/api/payment-proofs/77/receipt');
  const frame = host.querySelector('iframe');
  expect(frame.src).toBe('blob:synthetic-private-proof'); expect(frame.hasAttribute('sandbox')).toBe(false);
  expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer'); expect(host.textContent).toContain(proof.receipt_file_name);
  await click('Close proof'); expect(host.querySelector('iframe')).toBe(null);
  await click('View proof'); expect(getBlob).toHaveBeenCalledTimes(1);
});

test.each(['image/jpeg','image/png','image/webp'])('%s screenshots have an image preview and visible download controls', async mime => {
  getBlob.mockResolvedValue(new Blob(['synthetic image'],{type:mime}));
  await render(); await click('View proof'); expect(host.querySelector('img').src).toBe('blob:synthetic-private-proof');
  expect(host.querySelector('iframe')).toBe(null); expect(button('Download proof')).toBeTruthy();
});

test('one-click download preserves the original filename and does not require a preview or popup', async () => {
  await render(); await click('Download proof'); expect(downloaded).toEqual({name:proof.receipt_file_name,url:'blob:synthetic-private-proof'});
  expect(clickLink).toHaveBeenCalledTimes(1); expect(open).not.toHaveBeenCalled(); expect(host.querySelector('iframe')).toBe(null);
  expect(host.textContent).toContain('Proof downloaded');
});

test('Open creates a tab on the click and loads only the authenticated local blob without an opener', async () => {
  const tab = newTab(); open.mockReturnValue(tab);
  let finish; getBlob.mockReturnValue(new Promise(resolve => {finish=resolve;}));
  await render(); await click('Open proof in new tab'); expect(open).toHaveBeenCalledWith('about:blank','_blank'); expect(tab.opener).toBe(null);
  await act(async () => finish(new Blob(['%PDF'],{type:'application/pdf'})));
  expect(tab.location.replace).toHaveBeenCalledWith('blob:synthetic-private-proof');
  expect(host.textContent).toContain('Proof opened in a new tab');
});

test('blocked tabs and failed file retrieval give a download or refresh instruction', async () => {
  open.mockReturnValue(null); await render(); await click('Open proof in new tab');
  expect(getBlob).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]').textContent).toContain('Download proof');
  const tab = newTab(); open.mockReturnValue(tab); getBlob.mockRejectedValue(new Error('Refresh this page and try again.'));
  await click('Open proof in new tab'); expect(tab.close).toHaveBeenCalled(); expect(host.querySelector('[role="alert"]').textContent).toContain('Refresh');
});

test('an HTML error document cannot be opened, downloaded or embedded as a payment proof', async () => {
  const tab = newTab(); open.mockReturnValue(tab); getBlob.mockResolvedValue(new Blob(['<script>untrusted</script>'],{type:'text/html'}));
  await render(); await click('Open proof in new tab');
  expect(tab.close).toHaveBeenCalled(); expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(clickLink).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]').textContent).toContain('cannot be displayed safely');
});

test('switching proofs discards a delayed response, closes its empty tab and revokes old URLs', async () => {
  await render(); await click('View proof');
  await render({proof:{id:78}}); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-private-proof');
  const tab = newTab(); open.mockReturnValue(tab); let finish;
  getBlob.mockReturnValue(new Promise(resolve => {finish=resolve;})); await click('Open proof in new tab');
  await render({proof:{id:79}}); expect(tab.close).toHaveBeenCalled(); URL.createObjectURL.mockClear();
  await act(async () => finish(new Blob(['%PDF'],{type:'application/pdf'})));
  expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(tab.location.replace).not.toHaveBeenCalled(); expect(host.querySelector('iframe')).toBe(null);
});

test('a failed inline image preview retains working Open and Download alternatives', async () => {
  getBlob.mockResolvedValue(new Blob(['synthetic image'],{type:'image/png'}));
  await render(); await click('View proof');
  await act(async () => host.querySelector('img').dispatchEvent(new Event('error')));
  expect(host.textContent).toContain('could not display the proof inline');
  await click('Download proof'); expect(clickLink).toHaveBeenCalledTimes(1); expect(getBlob).toHaveBeenCalledTimes(1);
  await render({proof:{id:80}}); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-private-proof');
});
