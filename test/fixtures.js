'use strict';

const esprima = require('esprima');

function fn2str(fn) {
  return fn.toString().replace(/^\([^{]+{|}$/g, '');
}
exports.fn2str = fn2str;

function parse(fn) {
  return esprima.parse(fn2str(fn), { loc: true });
}
exports.parse = parse;
