'use strict';

const assert = require('assert');
const assertText = require('assert-text');
assertText.options.trim = true;

const fixtures = require('./fixtures');
const cfgjs = require('../');

function test(fn, expected) {
  const pipelines = cfgjs.build(fixtures.parse(fn));
  const actual = pipelines.map((cfg, i) => {
    return (i === 0 ? '' : (i + ': ')) + cfg.render({ cfg: true }, 'printable');
  }).join('\n');

  assertText.equal(actual, expected);
}

describe('CFG.js/Constructor', () => {
  it('should create empty graph', () => {
    test(() => {
    }, `pipeline {
      b0 {
      }
    }`);
  });

  describe('literals', () => {
    it('should construct number', () => {
      test(() => {
        1;
        1.23;
        "hello";
      }, `pipeline {
        b0 {
          i0 = literal 1
          i1 = literal 1.23
          i2 = literal "hello"
        }
      }`);
    });
  });

  describe('global', () => {
    it('should construct global load', () => {
      test(() => {
        a;
      }, `pipeline {
        b0 {
          i0 = loadGlobal "a"
        }
      }`);
    });

    it('should construct global store', () => {
      test(() => {
        a = 1;
      }, `pipeline {
        b0 {
          i0 = literal 1
          i1 = storeGlobal "a", i0
        }
      }`);
    });
  });

  describe('property', () => {
    it('should construct named property load', () => {
      test(() => {
        a.b;
      }, `pipeline {
        b0 {
          i0 = loadGlobal "a"
          i1 = loadNamedProperty "b", i0
        }
      }`);
    });

    it('should construct named property store', () => {
      test(() => {
        a.b = 1;
      }, `pipeline {
        b0 {
          i0 = loadGlobal "a"
          i1 = literal 1
          i2 = storeNamedProperty "b", i0, i1
        }
      }`);
    });

    it('should construct property load', () => {
      test(() => {
        a['b'];
      }, `pipeline {
        b0 {
          i0 = loadGlobal "a"
          i1 = literal "b"
          i2 = loadProperty i0, i1
        }
      }`);
    });

    it('should construct property store', () => {
      test(() => {
        a['b'] = 1;
      }, `pipeline {
        b0 {
          i0 = loadGlobal "a"
          i1 = literal "b"
          i2 = literal 1
          i3 = storeProperty i0, i1, i2
        }
      }`);
    });
  });

  describe('es5 scope', () => {
    it('should construct global var decl', () => {
      test(() => {
        var a = 0;

        a;
        a = 1;
      }, `pipeline {
        b0 {
          i0 = literal 0
          i1 = storeGlobal "a", i0
          i2 = loadGlobal "a"
          i3 = literal 1
          i4 = storeGlobal "a", i3
        }
      }`);
    });

    it('should construct local var decl', () => {
      test(() => {
        function local() {
          var a = 0;

          a;
          a = 1;
        }
      }, `pipeline {
        b0 {
          i0 = fn 1
          i1 = storeGlobal "local", i0
        }
      }
      1: pipeline {
        b0 {
          i0 = literal 0
          i1 = ssa:store "0/a", i0
          i2 = ssa:load "0/a"
          i3 = literal 1
          i4 = ssa:store "0/a", i3
        }
      }`);
    });
  });

  describe('es6 scope', () => {
    it('should lookup const variables', () => {
      test(() => {
        {
          a;
          const a = 1;

          {
            const a = 2;
            a;
          }

          a;
        }
      }, `pipeline {
        b0 {
          i0 = oddball "hole"
          i1 = ssa:store "0/a", i0
          i2 = ssa:load "0/a"
          i3 = literal 1
          i4 = ssa:store "0/a", i3
          i5 = oddball "hole"
          i6 = ssa:store "1/a", i5
          i7 = literal 2
          i8 = ssa:store "1/a", i7
          i9 = ssa:load "1/a"
          i10 = ssa:load "0/a"
        }
      }`);
    });

    it('should modify let variables', () => {
      test(() => {
        {
          a;
          let a = 1;

          {
            let a = 2;
            a = 3;
          }

          a = 4;
        }
      }, `pipeline {
        b0 {
          i0 = oddball "hole"
          i1 = ssa:store "0/a", i0
          i2 = ssa:load "0/a"
          i3 = literal 1
          i4 = ssa:store "0/a", i3
          i5 = oddball "hole"
          i6 = ssa:store "1/a", i5
          i7 = literal 2
          i8 = ssa:store "1/a", i7
          i9 = literal 3
          i10 = ssa:store "1/a", i9
          i11 = literal 4
          i12 = ssa:store "0/a", i11
        }
      }`);
    });
  });

  describe('functions', () => {
    it('should construct function declaration', () => {
      test(() => {
        a;
        function a() {
          a;
        }
      }, `pipeline {
        b0 {
          i0 = fn 1
          i1 = storeGlobal "a", i0
          i2 = loadGlobal "a"
        }
      }
      1: pipeline {
        b0 {
          i0 = loadGlobal "a"
        }
      }`);
    });

    it('should construct function expression', () => {
      test(() => {
        var b = function a() {
          a;
        }
      }, `pipeline {
        b0 {
          i0 = fn 1
          i1 = storeGlobal "b", i0
        }
      }
      1: pipeline {
        b0 {
          i0 = loadContext 0, -1
        }
      }`);
    });

    it('should construct proper function context name ref', () => {
      test(() => {
        var b = function a() {
          var c = function d() {
            a;
          }
        }
      }, `pipeline {
        b0 {
          i0 = fn 1
          i1 = storeGlobal "b", i0
        }
      }
      1: pipeline {
        b0 {
          i0 = fn 2
          i1 = ssa:store "0/c", i0
        }
      }
      2: pipeline {
        b0 {
          i0 = loadContext 1, -1
        }
      }`);
    });
  });
});
