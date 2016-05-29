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
          i0 = global
          i1 = literal "a"
          i2 = loadProperty i0, i1
        }
      }`);
    });

    it('should construct global store', () => {
      test(() => {
        a = 1;
      }, `pipeline {
        b0 {
          i0 = global
          i1 = literal "a"
          i2 = literal 1
          i3 = storeProperty i0, i1, i2
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
          i0 = global
          i1 = literal "a"
          i2 = loadProperty i0, i1
          i3 = literal "b"
          i4 = loadProperty i2, i3
        }
      }`);
    });

    it('should construct named property store', () => {
      test(() => {
        a.b = 1;
      }, `pipeline {
        b0 {
          i0 = global
          i1 = literal "a"
          i2 = loadProperty i0, i1
          i3 = literal "b"
          i4 = literal 1
          i5 = storeProperty i2, i3, i4
        }
      }`);
    });

    it('should construct property load', () => {
      test(() => {
        a['b'];
      }, `pipeline {
        b0 {
          i0 = global
          i1 = literal "a"
          i2 = loadProperty i0, i1
          i3 = literal "b"
          i4 = loadProperty i2, i3
        }
      }`);
    });

    it('should construct property store', () => {
      test(() => {
        a['b'] = 1;
      }, `pipeline {
        b0 {
          i0 = global
          i1 = literal "a"
          i2 = loadProperty i0, i1
          i3 = literal "b"
          i4 = literal 1
          i5 = storeProperty i2, i3, i4
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
          i0 = global
          i1 = literal "a"
          i2 = literal 0
          i3 = storeProperty i0, i1, i2
          i4 = global
          i5 = literal "a"
          i6 = loadProperty i4, i5
          i7 = global
          i8 = literal "a"
          i9 = literal 1
          i10 = storeProperty i7, i8, i9
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
          i0 = global
          i1 = literal "local"
          i2 = fn 1
          i3 = storeProperty i0, i1, i2
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
          i0 = global
          i1 = literal "a"
          i2 = fn 1
          i3 = storeProperty i0, i1, i2
          i4 = global
          i5 = literal "a"
          i6 = loadProperty i4, i5
        }
      }
      1: pipeline {
        b0 {
          i0 = global
          i1 = literal "a"
          i2 = loadProperty i0, i1
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
          i0 = global
          i1 = literal "b"
          i2 = fn 1
          i3 = storeProperty i0, i1, i2
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
          i0 = global
          i1 = literal "b"
          i2 = fn 1
          i3 = storeProperty i0, i1, i2
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
