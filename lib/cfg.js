'use strict';

exports.Slot = require('./cfg/slot');
exports.Constructor = require('./cfg/constructor');

// API

const constructor = new exports.Constructor();

exports.build = (ast, options) => {
  return constructor.build(ast);
};
