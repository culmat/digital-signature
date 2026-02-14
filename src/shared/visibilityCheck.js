export const ALWAYS = 'ALWAYS';
export const IF_SIGNATORY = 'IF_SIGNATORY';
export const IF_SIGNED = 'IF_SIGNED';

export function isSectionVisible(visibilitySetting, { isSignatory, hasSigned }) {
  switch (visibilitySetting) {
    case IF_SIGNATORY: return isSignatory;
    case IF_SIGNED:    return hasSigned;
    default:           return true;
  }
}
