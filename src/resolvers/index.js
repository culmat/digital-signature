import Resolver from '@forge/resolver';
import { signResolver } from './signResolver';
import { getSignaturesResolver } from './getSignaturesResolver';
import { checkAuthorizationResolver } from './checkAuthorizationResolver';

const resolver = new Resolver();

resolver.define('sign', signResolver);
resolver.define('getSignatures', getSignaturesResolver);
resolver.define('checkAuthorization', checkAuthorizationResolver);

export const handler = resolver.getDefinitions();
