/*
 * Copyright (c) 2021 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import ts from 'typescript';

import {
  COMPONENT_NON_DECORATOR,
  COMPONENT_STATE_DECORATOR,
  COMPONENT_PROP_DECORATOR,
  COMPONENT_LINK_DECORATOR,
  COMPONENT_STORAGE_LINK_DECORATOR,
  COMPONENT_PROVIDE_DECORATOR,
  COMPONENT_OBJECT_LINK_DECORATOR,
  COMPONENT_CREATE_FUNCTION,
  BASE_COMPONENT_NAME,
  CUSTOM_COMPONENT_EARLIER_CREATE_CHILD,
  COMPONENT_CONSTRUCTOR_UPDATE_PARAMS,
  CUSTOM_COMPONENT_FUNCTION_FIND_CHILD_BY_ID,
  COMPONENT_CONSTRUCTOR_UNDEFINED,
  CUSTOM_COMPONENT_NEEDS_UPDATE_FUNCTION,
  CUSTOM_COMPONENT_MARK_STATIC_FUNCTION
} from './pre_define';
import {
  propertyCollection,
  stateCollection,
  linkCollection,
  propCollection,
  regularCollection,
  storagePropCollection,
  storageLinkCollection,
  provideCollection,
  consumeCollection,
  objectLinkCollection,
  isStaticViewCollection
} from './validate_ui_syntax';
import {
  propAndLinkDecorators,
  curPropMap,
  observedPropertyDecorators,
  createViewCreate,
  createCustomComponentNewExpression
} from './process_component_member';
import {
  LogType,
  LogInfo,
  componentInfo
} from './utils';

const localArray: string[] = [...observedPropertyDecorators, COMPONENT_NON_DECORATOR,
  COMPONENT_PROP_DECORATOR, COMPONENT_OBJECT_LINK_DECORATOR];

const decoractorMap: Map<string, Map<string, Set<string>>> = new Map(
  [[COMPONENT_STATE_DECORATOR, stateCollection],
    [COMPONENT_LINK_DECORATOR, linkCollection],
    [COMPONENT_PROP_DECORATOR, propCollection],
    [COMPONENT_NON_DECORATOR, regularCollection],
    [COMPONENT_PROVIDE_DECORATOR, provideCollection],
    [COMPONENT_OBJECT_LINK_DECORATOR, objectLinkCollection]]);

export function processCustomComponent(node: ts.ExpressionStatement, newStatements: ts.Statement[],
  log: LogInfo[]): void {
  if (ts.isCallExpression(node.expression)) {
    addCustomComponent(node, newStatements, createCustomComponentNewExpression(node.expression), log);
  }
}

function addCustomComponent(node: ts.ExpressionStatement, newStatements: ts.Statement[],
  newNode: ts.NewExpression, log: LogInfo[]): void {
  if (ts.isNewExpression(newNode)) {
    const customComponentName: string = getCustomComponentName(newNode);
    const propertyArray: ts.ObjectLiteralElementLike[] = [];
    validateCustomComponentPrams(node, customComponentName, propertyArray, log);
    addCustomComponentStatements(node, newStatements, newNode, customComponentName, propertyArray);
  }
}

function addCustomComponentStatements(node: ts.ExpressionStatement, newStatements: ts.Statement[],
  newNode: ts.NewExpression, name: string, props: ts.ObjectLiteralElementLike[]): void {
  const id: string = componentInfo.id.toString();
  newStatements.push(createFindChildById(id), createCustomComponentIfStatement(id,
    ts.factory.updateExpressionStatement(node, createViewCreate(newNode)),
    ts.factory.createObjectLiteralExpression(props, true), name));
}

function validateCustomComponentPrams(node: ts.ExpressionStatement, name: string,
  props: ts.ObjectLiteralElementLike[], log: LogInfo[]): void {
  const curChildProps: Set<string> = new Set([]);
  const nodeExpression: ts.CallExpression = node.expression as ts.CallExpression;
  const nodeArguments: ts.NodeArray<ts.Expression> = nodeExpression.arguments;
  const propertySet: Set<string> = getCollectionSet(name, propertyCollection);
  const linkSet: Set<string> = getCollectionSet(name, linkCollection);
  if (nodeArguments && nodeArguments.length === 1 &&
    ts.isObjectLiteralExpression(nodeArguments[0])) {
    const nodeArgument: ts.ObjectLiteralExpression = nodeArguments[0] as ts.ObjectLiteralExpression;
    nodeArgument.properties.forEach(item => {
      if (item.name && item.name.escapedText) {
        // @ts-ignore
        curChildProps.add(item.name.escapedText.toString());
      }
      if (isThisProperty(item, propertySet)) {
        validateStateManagement(item, name, log);
        if (isNonThisProperty(item, linkSet)) {
          props.push(item);
        }
      } else {
        validateNonExistentProperty(item, name, log);
      }
    });
  }
  validateMandatoryToInitViaParam(node, name, curChildProps, log);
}

function getCustomComponentName(newNode: ts.NewExpression): string {
  let customComponentName: string;
  if (ts.isIdentifier(newNode.expression)) {
    customComponentName = newNode.expression.escapedText.toString();
  } else if (ts.isPropertyAccessExpression(newNode.expression)) {
    customComponentName = newNode.expression.name.escapedText.toString();
  }
  return customComponentName;
}

function getCollectionSet(name: string, collection: Map<string, Set<string>>): Set<string> {
  return collection.get(name) || new Set([]);
}

function isThisProperty(node: ts.ObjectLiteralElementLike, propertySet: Set<string>): boolean {
  if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) &&
    propertySet.has(node.name.escapedText.toString())) {
    return true;
  }
  return false;
}

function isNonThisProperty(node: ts.ObjectLiteralElementLike, propertySet: Set<string>): boolean {
  if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) &&
    !propertySet.has(node.name.escapedText.toString())) {
    return true;
  }
  return false;
}

function validateStateManagement(node: ts.ObjectLiteralElementLike, customComponentName: string,
  log: LogInfo[]): void {
  validateForbiddenToInitViaParam(node, customComponentName, log);
  checkFromParentToChild(node, customComponentName, log);
}

function checkFromParentToChild(node: ts.ObjectLiteralElementLike, customComponentName: string,
  log: LogInfo[]): void {
  let propertyName: string;
  if (node.name && node.name.escapedText) {
    // @ts-ignore
    propertyName = node.name.escapedText.toString();
  }
  const curPropertyKind: string = getPropertyDecoratorKind(propertyName, customComponentName);
  if (curPropertyKind) {
    if (isInitFromParent(node)) {
      const parentPropertyName: string =
        getParentPropertyName(node as ts.PropertyAssignment, curPropertyKind, log);
      if (!parentPropertyName) {
        return;
      }
      const parentPropertyKind: string = curPropMap.get(parentPropertyName);
      if (parentPropertyKind && !isCorrectInitFormParent(parentPropertyKind, curPropertyKind)) {
        validateIllegalInitFromParent(
          node, propertyName, curPropertyKind, parentPropertyName, parentPropertyKind, log);
      }
    } else if (isInitFromLocal(node) && ts.isPropertyAssignment(node)) {
      if (!localArray.includes(curPropertyKind)) {
        validateIllegalInitFromParent(node, propertyName, curPropertyKind,
          node.initializer.getText(), COMPONENT_NON_DECORATOR, log);
      }
    }
  }
}

function isInitFromParent(node: ts.ObjectLiteralElementLike): boolean {
  if (ts.isPropertyAssignment(node) && node.initializer) {
    if (ts.isPropertyAccessExpression(node.initializer) && node.initializer.expression &&
    node.initializer.expression.kind === ts.SyntaxKind.ThisKeyword &&
    ts.isIdentifier(node.initializer.name)) {
      return true;
    } else if (ts.isIdentifier(node.initializer) &&
      matchStartWithDollar(node.initializer.getText())) {
      return true;
    }
  }
}

function isInitFromLocal(node: ts.ObjectLiteralElementLike): boolean {
  if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.initializer) &&
    !matchStartWithDollar(node.initializer.getText())) {
    return true;
  }
}

function getParentPropertyName(node: ts.PropertyAssignment, curPropertyKind: string,
  log: LogInfo[]): string {
  let parentPropertyName: string;
  const initExpression: ts.Expression = node.initializer;
  if (curPropertyKind === COMPONENT_LINK_DECORATOR) {
    if (hasDollar(initExpression)) {
      // @ts-ignore
      const initName: ts.Identifier = initExpression.name || initExpression;
      parentPropertyName = initName.getText().replace(/^\$/, '');
    } else {
      validateLinkWithoutDollar(node, log);
    }
  } else {
    if (hasDollar(initExpression)) {
      validateNonLinkWithDollar(node, log);
    } else {
    // @ts-ignore
      parentPropertyName = node.initializer.name.getText();
    }
  }
  return parentPropertyName;
}

function isCorrectInitFormParent(parent: string, child: string): boolean {
  switch (child) {
    case COMPONENT_STATE_DECORATOR:
    case COMPONENT_PROVIDE_DECORATOR:
      if (parent === COMPONENT_NON_DECORATOR) {
        return true;
      }
      break;
    case COMPONENT_LINK_DECORATOR:
      if ([COMPONENT_STATE_DECORATOR, COMPONENT_LINK_DECORATOR,
        COMPONENT_STORAGE_LINK_DECORATOR].includes(parent)) {
        return true;
      }
      break;
    case COMPONENT_PROP_DECORATOR:
      if ([COMPONENT_STATE_DECORATOR, ...propAndLinkDecorators].includes(parent)) {
        return true;
      }
      break;
    case COMPONENT_NON_DECORATOR:
      if ([COMPONENT_STATE_DECORATOR, ...propAndLinkDecorators, COMPONENT_NON_DECORATOR,
        COMPONENT_OBJECT_LINK_DECORATOR, COMPONENT_STORAGE_LINK_DECORATOR].includes(parent)) {
        return true;
      }
      break;
    case COMPONENT_OBJECT_LINK_DECORATOR:
      if (parent === COMPONENT_STATE_DECORATOR) {
        return true;
      }
      break;
  }
  return false;
}

function getPropertyDecoratorKind(propertyName: string, customComponentName: string): string {
  for (const item of decoractorMap.entries()) {
    if (getCollectionSet(customComponentName, item[1]).has(propertyName)) {
      return item[0];
    }
  }
}

function createFindChildById(id: string): ts.VariableStatement {
  return ts.factory.createVariableStatement(undefined, ts.factory.createVariableDeclarationList(
    [ts.factory.createVariableDeclaration(ts.factory.createIdentifier(
      `${CUSTOM_COMPONENT_EARLIER_CREATE_CHILD}${id}`), undefined, undefined,
    ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(ts.factory.createThis(),
      ts.factory.createIdentifier(`${CUSTOM_COMPONENT_FUNCTION_FIND_CHILD_BY_ID}`)), undefined,
    [ts.factory.createStringLiteral(id)]))], ts.NodeFlags.Let));
}

function createCustomComponentIfStatement(id: string, node: ts.ExpressionStatement,
  newObjectLiteralExpression: ts.ObjectLiteralExpression, parentName: string): ts.IfStatement {
  const viewName: string = `${CUSTOM_COMPONENT_EARLIER_CREATE_CHILD}${id}`;
  return ts.factory.createIfStatement(ts.factory.createBinaryExpression(
    ts.factory.createIdentifier(viewName),
    ts.factory.createToken(ts.SyntaxKind.EqualsEqualsToken),
    ts.factory.createIdentifier(`${COMPONENT_CONSTRUCTOR_UNDEFINED}`)),
  ts.factory.createBlock([node], true),
  ts.factory.createBlock([ts.factory.createExpressionStatement(ts.factory.createCallExpression(
    ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(
      viewName), ts.factory.createIdentifier(
      `${COMPONENT_CONSTRUCTOR_UPDATE_PARAMS}`)), undefined, [newObjectLiteralExpression])),
  isStaticViewCollection.get(parentName) ? createStaticIf(viewName) : undefined,
  ts.factory.createExpressionStatement(ts.factory.createCallExpression(
    ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(`${BASE_COMPONENT_NAME}`),
      ts.factory.createIdentifier(`${COMPONENT_CREATE_FUNCTION}`)), undefined,
    [ts.factory.createIdentifier(viewName)]))], true));
}

function createStaticIf(name: string): ts.IfStatement {
  return ts.factory.createIfStatement(ts.factory.createPrefixUnaryExpression(
    ts.SyntaxKind.ExclamationToken, ts.factory.createCallExpression(
      ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(name),
        ts.factory.createIdentifier(CUSTOM_COMPONENT_NEEDS_UPDATE_FUNCTION)), undefined, [])),
  ts.factory.createBlock([ts.factory.createExpressionStatement(ts.factory.createCallExpression(
    ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(name),
      ts.factory.createIdentifier(CUSTOM_COMPONENT_MARK_STATIC_FUNCTION)),
    undefined, []))], true), undefined);
}

function hasDollar(initExpression: ts.Expression): boolean {
  if (ts.isPropertyAccessExpression(initExpression) &&
    matchStartWithDollar(initExpression.name.getText())) {
    return true;
  } else if (ts.isIdentifier(initExpression) && matchStartWithDollar(initExpression.getText())) {
    return true;
  } else {
    return false;
  }
}

function matchStartWithDollar(name: string): boolean {
  return /^\$/.test(name);
}

function validateForbiddenToInitViaParam(node: ts.ObjectLiteralElementLike,
  customComponentName: string, log: LogInfo[]): void {
  const forbiddenToInitViaParamSet: Set<string> = new Set([
    ...getCollectionSet(customComponentName, storageLinkCollection),
    ...getCollectionSet(customComponentName, storagePropCollection),
    ...getCollectionSet(customComponentName, consumeCollection)]);
  if (isThisProperty(node, forbiddenToInitViaParamSet)) {
    log.push({
      type: LogType.ERROR,
      message: `Property '${node.name.getText()}' in the custom component '${customComponentName}'` +
        ` cannot initialize here (forbidden to specify).`,
      pos: node.name.getStart()
    });
  }
}

function validateNonExistentProperty(node: ts.ObjectLiteralElementLike,
  customComponentName: string, log: LogInfo[]): void {
  log.push({
    type: LogType.ERROR,
    message: `Property '${node.name.getText()}' does not exist on type '${customComponentName}'.`,
    pos: node.name.getStart()
  });
}

function validateMandatoryToInitViaParam(node: ts.ExpressionStatement, customComponentName: string,
  curChildProps: Set<string>, log: LogInfo[]): void {
  const mandatoryToInitViaParamSet: Set<string> = new Set([
    ...getCollectionSet(customComponentName, propCollection),
    ...getCollectionSet(customComponentName, linkCollection),
    ...getCollectionSet(customComponentName, objectLinkCollection)]);
  mandatoryToInitViaParamSet.forEach(item => {
    if (!curChildProps.has(item)) {
      log.push({
        type: LogType.ERROR,
        message: `Property '${item}' in the custom component '${customComponentName}'` +
          ` is missing (mandatory to specify).`,
        pos: node.getStart()
      });
    }
  });
}

function validateIllegalInitFromParent(node: ts.ObjectLiteralElementLike, propertyName: string,
  curPropertyKind: string, parentPropertyName: string, parentPropertyKind: string,
  log: LogInfo[]): void {
  log.push({
    type: LogType.ERROR,
    message: `The ${parentPropertyKind} property '${parentPropertyName}' cannot be assigned to ` +
      `the ${curPropertyKind} property '${propertyName}'.`,
    // @ts-ignore
    pos: node.initializer.getStart()
  });
}

function validateLinkWithoutDollar(node: ts.PropertyAssignment, log: LogInfo[]): void {
  log.push({
    type: LogType.ERROR,
    message: `The @Link property '${node.name.getText()}' should initialize` +
      ` using '$' to create a reference to a @State or @Link variable.`,
    pos: node.initializer.getStart()
  });
}

function validateNonLinkWithDollar(node: ts.PropertyAssignment, log: LogInfo[]): void {
  log.push({
    type: LogType.ERROR,
    message: `Property '${node.name.getText()}' cannot initialize` +
      ` using '$' to create a reference to a variable.`,
    pos: node.initializer.getStart()
  });
}
