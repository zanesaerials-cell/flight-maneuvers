import { C172S_HINGES, C172S_PROP_HUB, C172S_WHEEL_CONTACTS, type V3 } from './c172sRig';

/**
 * How each airplane's 3D model is put together.
 * Model frame: nose −Z, right wing +X, up +Y, metres, origin at the CG.
 */
export interface ModelRig {
  /** Tire contact points: left main, right main, nose. */
  wheelContacts: V3[];
  /** Hinge lines for models whose control surfaces are separate parts. */
  hinges?: Record<string, [V3, V3]>;
  /** Hub of a propeller that is a separate part named "prop". */
  propHub?: V3;
  /** Propeller discs drawn over models whose propellers are not separate parts: left to right. */
  propDiscs?: { at: V3; radius: number }[];
  /** Stand-in shape while the model loads or when its file is not present. */
  fallback: 'high-wing' | 'low-wing';
}

export const MODEL_RIGS: Record<string, ModelRig> = {
  c172s: { wheelContacts: C172S_WHEEL_CONTACTS, hinges: C172S_HINGES, propHub: C172S_PROP_HUB, fallback: 'high-wing' },
  'p-mentor': {
    wheelContacts: [[-0.944, -1.173, 0.178], [0.944, -1.173, 0.178], [0, -1.185, -1.462]],
    propDiscs: [{ at: [0, -0.05, -2.2], radius: 0.86 }],
    fallback: 'low-wing',
  },
  da42: {
    wheelContacts: [[-1.358, -1.231, 0.203], [1.358, -1.231, 0.203], [0, -1.223, -1.228]],
    propDiscs: [{ at: [-1.72, -0.05, -1.6], radius: 0.93 }, { at: [1.72, -0.05, -1.6], radius: 0.93 }],
    fallback: 'low-wing',
  },
};
