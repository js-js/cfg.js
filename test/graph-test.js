var assert = require('assert');
var esprima = require('esprima');
var ir = require('cfg-ir');
var cfg = require('../');

var fixtures = require('./fixtures');
var strip = fixtures.strip;
var equalLines = fixtures.equalLines;

describe('CFG.js/Graph', function() {
  function toCFG(fn) {
    return ir.parse(toString(fn));
  }

  function toString(fn) {
    return fn.toString().replace(/^function[^{]*{\/\*|\*\/}$/g, '');
  }

  it('should create/strip graph', function() {
    var c = toCFG(function() {/*
      block B1
        i1 = a
        i2 = b i1
        c
    */});
    var expected = toString(function() {/*
      block B1
        i1 = a
        i2 = b i1
        c
    */});

    var g = new cfg.Graph(c).construct();

    equalLines(strip(ir.stringify(cfg.Graph.strip(g))), strip(expected));
  });
});
