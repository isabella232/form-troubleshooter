/* Copyright 2021 Google LLC.
SPDX-License-Identifier: Apache-2.0 */

/* global chrome */

const IGNORE_CHILDREN = ['head', 'script', 'style', 'svg'];
const IGNORE_ATTRIBUTES = ['autofill-information', 'autofill-prediction'];

// Listen for a message from the popup that it has been opened.
// Need to re-run the audits here every time the popup is opened.
chrome.runtime.onMessage.addListener(
  (request, sender, sendResponse) => {
    if (request.message === 'popup opened' && window.parent === window) {
      chrome.storage.local.clear(() => {
        const error = chrome.runtime.lastError;
        if (error) {
          console.error('chrome.storage.local.clear() error in content-script.js:', error);
        } else {
          getTree(document)
            .then(tree => {
              chrome.storage.local.set({tree: tree}, () => {
                chrome.runtime.sendMessage({broadcast: true, message: 'dom inspected'});
              });
            });
        }
      });
    } else if (request.message === 'inspect'
        && ((request.name === window.name && request.url === window.location.href)
          || (request.name && request.name === window.name) // in case the iframe gets redirected
          || (request.url && request.url === window.location.href))) {
      getTree(document)
        .then(tree => {
          sendResponse(tree);
        });
      return true;
    }
  }
);

/**
 * Tree node type
 * @typedef {{name?: string, text?: string, type?: string, children?: TreeNode[], attributes?: {[key: string]: string}}} TreeNode
 */

/**
 * Gets a simplified/JSON serializable representation of the DOM tree
 * @param {Element} parent
 * @returns {TreeNode}
 */
async function getTree(parent) {
  const tree = {};
  const queue = [...parent.childNodes].map(child => ({
    element: child,
    node: tree,
  }));
  let item;

  while ((item = queue.shift())) {
    const node = {};

    if (item.element.nodeType === Node.TEXT_NODE && item.element.nodeValue.trim()) {
      node.text = item.element.nodeValue;
    } else if (item.element instanceof Element) {
      node.name = item.element.tagName.toLowerCase();
      const attributes = Array.from(item.element.attributes)
        .filter(a => !IGNORE_ATTRIBUTES.some(ignored => a.name === ignored))
        .map(a => ([a.name, a.value]));
      if (attributes.length > 0) {
        node.attributes = Object.fromEntries(attributes);
      }
    } else {
      continue;
    }

    if (!item.node.children) {
      item.node.children = [];
    }
    item.node.children.push(node);

    // don't inspect the child nodes of ignored tags
    if (!IGNORE_CHILDREN.some(ignored => node.name === ignored)) {
      queue.push(...[...item.element.childNodes].map(child => ({
        element: child,
        node,
      })));
    }

    if (item.element.shadowRoot) {
      const shadowNode = {
        type: '#shadow-root',
        children: [],
      };
      if (!node.children) {
        node.children = [];
      }
      node.children.push(shadowNode);
      queue.push(...[...item.element.shadowRoot.childNodes].map(child => ({
        element: child,
        node: shadowNode,
      })));
    }

    if (item.element instanceof HTMLIFrameElement) {
      const iframeContent = await sendMessageAndWait({broadcast: true, wait: true, message: 'inspect', name: item.element.name, url: item.element.src});
      const iframeNode = {
        type: '#document',
        children: [iframeContent],
      };
      if (!node.children) {
        node.children = [];
      }
      node.children.push(iframeNode);
    }
  }

  return tree;
}

function sendMessageAndWait(message, timeoutDuration = 500) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout duration exceeded'));
    }, timeoutDuration);
    chrome.runtime.sendMessage(message, response => {
      clearTimeout(timeout);
      resolve(response);
    });
  });
}
