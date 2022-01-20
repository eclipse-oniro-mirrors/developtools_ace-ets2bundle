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
  INNER_COMPONENT_MEMBER_DECORATORS,
  COMPONENT_NON_DECORATOR,
  COMPONENT_STATE_DECORATOR,
  COMPONENT_PROP_DECORATOR,
  COMPONENT_LINK_DECORATOR,
  COMPONENT_STORAGE_PROP_DECORATOR,
  COMPONENT_STORAGE_LINK_DECORATOR,
  COMPONENT_PROVIDE_DECORATOR,
  COMPONENT_CONSUME_DECORATOR,
  COMPONENT_OBJECT_LINK_DECORATOR,
  COMPONENT_WATCH_DECORATOR,
  COMPONENT_OBSERVED_DECORATOR,
  OBSERVED_PROPERTY_SIMPLE,
  OBSERVED_PROPERTY_OBJECT,
  SYNCHED_PROPERTY_SIMPLE_ONE_WAY,
  SYNCHED_PROPERTY_SIMPLE_TWO_WAY,
  SYNCHED_PROPERTY_OBJECT_TWO_WAY,
  SYNCHED_PROPERTY_NESED_OBJECT,
  CREATE_GET_METHOD,
  CREATE_SET_METHOD,
  CREATE_NEWVALUE_IDENTIFIER,
  CREATE_CONSTRUCTOR_PARAMS,
  ADD_PROVIDED_VAR,
  INITIALIZE_CONSUME_FUNCTION,
  APP_STORAGE,
  APP_STORAGE_SET_AND_PROP,
  APP_STORAGE_SET_AND_LINK,
  APP_STORAGE_GET_OR_SET,
  COMPONENT_CONSTRUCTOR_UNDEFINED,
  SET_CONTROLLER_METHOD,
  SET_CONTROLLER_CTR,
  SET_CONTROLLER_CTR_TYPE,
  JS_DIALOG,
  CUSTOM_DIALOG_CONTROLLER_BUILDER,
  BASE_COMPONENT_NAME,
  COMPONENT_CREATE_FUNCTION,
  COMPONENT_BUILDERPARAM_DECORATOR
} from './pre_define';
import {
  forbiddenUseStateType,
  BUILDIN_STYLE_NAMES
} from './component_map';
import {
  observedClassCollection,
  enumCollection,
  componentCollection,
  classMethodCollection
} from './validate_ui_syntax';
import { updateConstructor } from './process_component_constructor';
import {
  LogType,
  LogInfo,
  componentInfo,
  createFunction
} from './utils';
import {
  createReference,
  isProperty
} from './process_component_class';

export type ControllerType = {
  hasController: boolean
}

export const observedPropertyDecorators: Set<string> =
  new Set([COMPONENT_STATE_DECORATOR, COMPONENT_PROVIDE_DECORATOR]);

export const propAndLinkDecorators: Set<string> =
  new Set([COMPONENT_PROP_DECORATOR, COMPONENT_LINK_DECORATOR]);

export const appStorageDecorators: Set<string> =
  new Set([COMPONENT_STORAGE_PROP_DECORATOR, COMPONENT_STORAGE_LINK_DECORATOR]);

export const mandatorySpecifyDefaultValueDecorators: Set<string> =
  new Set([...observedPropertyDecorators, ...appStorageDecorators]);

export const forbiddenSpecifyDefaultValueDecorators: Set<string> =
  new Set([...propAndLinkDecorators, COMPONENT_CONSUME_DECORATOR, COMPONENT_OBJECT_LINK_DECORATOR]);

export const mandatoryToInitViaParamDecorators: Set<string> =
  new Set([...propAndLinkDecorators, COMPONENT_OBJECT_LINK_DECORATOR]);

export const setUpdateParamsDecorators: Set<string> =
  new Set([...observedPropertyDecorators, COMPONENT_PROP_DECORATOR, COMPONENT_OBJECT_LINK_DECORATOR,
    COMPONENT_BUILDERPARAM_DECORATOR
  ]);

export const immutableDecorators: Set<string> =
  new Set([COMPONENT_STORAGE_PROP_DECORATOR, COMPONENT_OBJECT_LINK_DECORATOR, COMPONENT_BUILDERPARAM_DECORATOR]);

export const simpleTypes: Set<ts.SyntaxKind> = new Set([ts.SyntaxKind.StringKeyword,
  ts.SyntaxKind.NumberKeyword, ts.SyntaxKind.BooleanKeyword, ts.SyntaxKind.EnumDeclaration]);

export const decoratorParamSet: Set<string> = new Set();

export const stateObjectCollection: Set<string> = new Set();

export const builderParamObjectCollection: Map<string, Set<string>> = new Map();

export class UpdateResult {
  private itemUpdate: boolean = false;
  private ctorUpdate: boolean = false;
  private properity: ts.PropertyDeclaration;
  private ctor: ts.ConstructorDeclaration;
  private variableGet: ts.GetAccessorDeclaration;
  private variableSet: ts.SetAccessorDeclaration;
  private updateParams: ts.Statement;
  private deleteParams: boolean = false;
  private controllerSet: ts.MethodDeclaration;

  public setProperity(updateItem: ts.PropertyDeclaration) {
    this.itemUpdate = true;
    this.properity = updateItem;
  }

  public setCtor(updateCtor: ts.ConstructorDeclaration) {
    this.ctorUpdate = true;
    this.ctor = updateCtor;
  }

  public setControllerSet(updateControllerSet: ts.MethodDeclaration) {
    this.controllerSet = updateControllerSet;
  }

  public getControllerSet(): ts.MethodDeclaration {
    return this.controllerSet;
  }

  public setVariableGet(updateVariableGet: ts.GetAccessorDeclaration) {
    this.variableGet = updateVariableGet;
  }

  public setVariableSet(updateVariableSet: ts.SetAccessorDeclaration) {
    this.variableSet = updateVariableSet;
  }

  public setUpdateParams(updateParams: ts.Statement) {
    this.updateParams = updateParams;
  }

  public setDeleteParams(deleteParams: boolean) {
    this.deleteParams = deleteParams;
  }

  public isItemUpdate(): boolean {
    return this.itemUpdate;
  }

  public isCtorUpdate(): boolean {
    return this.ctorUpdate;
  }

  public getProperity(): ts.PropertyDeclaration {
    return this.properity;
  }

  public getCtor(): ts.ConstructorDeclaration {
    return this.ctor;
  }

  public getUpdateParams(): ts.Statement {
    return this.updateParams;
  }

  public getVariableGet(): ts.GetAccessorDeclaration {
    return this.variableGet;
  }

  public getVariableSet(): ts.SetAccessorDeclaration {
    return this.variableSet;
  }

  public isDeleteParams(): boolean {
    return this.deleteParams;
  }
}

export const curPropMap: Map<string, string> = new Map();

export function processMemberVariableDecorators(parentName: ts.Identifier,
  item: ts.PropertyDeclaration, ctorNode: ts.ConstructorDeclaration, watchMap: Map<string, ts.Node>,
  checkController: ControllerType, log: LogInfo[], program: ts.Program,
  context: ts.TransformationContext, hasPreview: boolean): UpdateResult {
  const updateResult: UpdateResult = new UpdateResult();
  const name: ts.Identifier = item.name as ts.Identifier;
  if (!item.decorators || !item.decorators.length) {
    curPropMap.set(name.escapedText.toString(), COMPONENT_NON_DECORATOR);
    updateResult.setProperity(undefined);
    updateResult.setUpdateParams(createUpdateParams(name, COMPONENT_NON_DECORATOR));
    updateResult.setCtor(updateConstructor(ctorNode, [], [
      createVariableInitStatement(item, COMPONENT_NON_DECORATOR, log, program, context, hasPreview)]));
    updateResult.setControllerSet(createControllerSet(item, parentName, name, checkController));
  } else if (!item.type) {
    validatePropertyNonType(name, log);
    return updateResult;
  } else {
    processPropertyNodeDecorator(parentName, item, updateResult, ctorNode, name, watchMap,
      log, program, context, hasPreview);
  }
  return updateResult;
}

function createControllerSet(node: ts.PropertyDeclaration, componentName: ts.Identifier,
  name: ts.Identifier, checkController: ControllerType): ts.MethodDeclaration {
  if (componentCollection.customDialogs.has(componentName.getText()) && node.type &&
    node.type.getText() === SET_CONTROLLER_CTR_TYPE) {
    checkController.hasController = true;
    return ts.factory.createMethodDeclaration(undefined, undefined, undefined,
      ts.factory.createIdentifier(SET_CONTROLLER_METHOD), undefined, undefined,
      [ts.factory.createParameterDeclaration(undefined, undefined, undefined,
        ts.factory.createIdentifier(SET_CONTROLLER_CTR), undefined,
        ts.factory.createTypeReferenceNode(ts.factory.createIdentifier(SET_CONTROLLER_CTR_TYPE),
          undefined), undefined)], undefined, ts.factory.createBlock(
        [ts.factory.createExpressionStatement(ts.factory.createBinaryExpression(
          ts.factory.createPropertyAccessExpression(ts.factory.createThis(), name),
          ts.factory.createToken(ts.SyntaxKind.EqualsToken),
          ts.factory.createIdentifier(SET_CONTROLLER_CTR)))], true));
  }
}

function processPropertyNodeDecorator(parentName: ts.Identifier, node: ts.PropertyDeclaration,
  updateResult: UpdateResult, ctorNode: ts.ConstructorDeclaration, name: ts.Identifier,
  watchMap: Map<string, ts.Node>, log: LogInfo[], program: ts.Program,
  context: ts.TransformationContext, hasPreview: boolean): void {
  let stateManagementDecoratorCount: number = 0;
  for (let i = 0; i < node.decorators.length; i++) {
    const decoratorName: string = node.decorators[i].getText().replace(/\(.*\)$/, '').trim();
    if (decoratorName !== COMPONENT_WATCH_DECORATOR) {
      curPropMap.set(name.escapedText.toString(), decoratorName);
    }
    if (BUILDIN_STYLE_NAMES.has(decoratorName.replace('@', ''))) {
      validateDuplicateDecorator(node.decorators[i], log);
    }
    if (decoratorName !== COMPONENT_WATCH_DECORATOR && isForbiddenUseStateType(node.type)) {
      // @ts-ignore
      validateForbiddenUseStateType(name, decoratorName, node.type.typeName.getText(), log);
      return;
    }
    if (parentName.getText() === componentCollection.entryComponent &&
      mandatoryToInitViaParamDecorators.has(decoratorName)) {
      validateHasIllegalDecoratorInEntry(parentName, name, decoratorName, log);
    }
    if (node.initializer && forbiddenSpecifyDefaultValueDecorators.has(decoratorName)) {
      validatePropertyDefaultValue(name, decoratorName, log);
      return;
    } else if (!node.initializer && mandatorySpecifyDefaultValueDecorators.has(decoratorName)) {
      validatePropertyNonDefaultValue(name, decoratorName, log);
      return;
    }
    if (node.questionToken && mandatoryToInitViaParamDecorators.has(decoratorName)) {
      validateHasIllegalQuestionToken(name, decoratorName, log);
    }
    if (!isSimpleType(node.type, program) &&
      decoratorName !== COMPONENT_BUILDERPARAM_DECORATOR) {
      stateObjectCollection.add(name.escapedText.toString());
    }
    if (decoratorName === COMPONENT_WATCH_DECORATOR &&
      validateWatchDecorator(name, node.decorators.length, log)) {
      processWatch(node, node.decorators[i], watchMap, log);
    } else if (INNER_COMPONENT_MEMBER_DECORATORS.has(decoratorName)) {
      stateManagementDecoratorCount += 1;
      processStateDecorators(node, decoratorName, updateResult, ctorNode, log, program, context, hasPreview);
    }
  }
  if (stateManagementDecoratorCount > 1) {
    validateMultiDecorators(name, log);
    return;
  }
}

function processStateDecorators(node: ts.PropertyDeclaration, decorator: string,
  updateResult: UpdateResult, ctorNode: ts.ConstructorDeclaration, log: LogInfo[],
  program: ts.Program, context: ts.TransformationContext, hasPreview:boolean): void {
  const name: ts.Identifier = node.name as ts.Identifier;
  updateResult.setProperity(undefined);
  const updateState: ts.Statement[] = [];
  const variableInitStatement: ts.Statement =
    createVariableInitStatement(node, decorator, log, program, context, hasPreview);
  if (variableInitStatement) {
    updateState.push(variableInitStatement);
  }
  addAddProvidedVar(node, name, decorator, updateState);
  updateResult.setCtor(updateConstructor(ctorNode, [], [...updateState], false));
  if (decorator !== COMPONENT_BUILDERPARAM_DECORATOR) {
    updateResult.setVariableGet(createGetAccessor(name, CREATE_GET_METHOD));
    updateResult.setDeleteParams(true);
  }
  if (!immutableDecorators.has(decorator)) {
    updateResult.setVariableSet(createSetAccessor(name, CREATE_SET_METHOD));
  }
  if (setUpdateParamsDecorators.has(decorator)) {
    updateResult.setUpdateParams(createUpdateParams(name, decorator));
  }
}

function processWatch(node: ts.PropertyDeclaration, decorator: ts.Decorator,
  watchMap: Map<string, ts.Node>, log: LogInfo[]): void {
  if (node.name) {
    const propertyName: string = node.name.getText();
    if (decorator.expression && ts.isCallExpression(decorator.expression) &&
      decorator.expression.arguments && decorator.expression.arguments.length === 1) {
      const currentClassMethod: Set<string> = classMethodCollection.get(node.parent.name.getText());
      const argument: ts.Node = decorator.expression.arguments[0];
      if (ts.isStringLiteral(argument)) {
        if (currentClassMethod.has(argument.text)) {
          watchMap.set(propertyName, argument);
        } else {
          log.push({
            type: LogType.ERROR,
            message: `Cannot find name ${argument.getText()} in struct '${node.parent.name.getText()}'.`,
            pos: argument.getStart()
          });
        }
      } else if (ts.isIdentifier(decorator.expression.arguments[0])) {
        const content: string = decorator.expression.arguments[0].getText();
        const propertyNode: ts.PropertyAccessExpression = createPropertyAccessExpressionWithThis(content);
        watchMap.set(propertyName, propertyNode);
        decoratorParamSet.add(content);
        validateWatchParam(LogType.WARN, argument.getStart(), log);
      } else if (ts.isPropertyAccessExpression(decorator.expression.arguments[0])) {
        watchMap.set(propertyName, decorator.expression.arguments[0]);
        validateWatchParam(LogType.WARN, argument.getStart(), log);
      } else {
        validateWatchParam(LogType.ERROR, argument.getStart(), log);
      }
    }
  }
}

function createVariableInitStatement(node: ts.PropertyDeclaration, decorator: string,
  log: LogInfo[], program: ts.Program, context: ts.TransformationContext, hasPreview: boolean):
  ts.Statement {
  const name: ts.Identifier = node.name as ts.Identifier;
  let type: ts.TypeNode;
  let updateState: ts.ExpressionStatement;
  if (node.type) {
    type = node.type;
  }
  switch (decorator) {
    case COMPONENT_NON_DECORATOR:
      updateState = updateNormalProperty(node, name, log, context);
      break;
    case COMPONENT_STATE_DECORATOR:
    case COMPONENT_PROVIDE_DECORATOR:
      updateState = updateObservedProperty(node, name, type, program);
      break;
    case COMPONENT_LINK_DECORATOR:
      wrongDecoratorInPreview(node, COMPONENT_LINK_DECORATOR, hasPreview, log);
      updateState = updateSynchedPropertyTwoWay(name, type, program);
      break;
    case COMPONENT_PROP_DECORATOR:
      wrongDecoratorInPreview(node, COMPONENT_PROP_DECORATOR, hasPreview, log);
      updateState = updateSynchedPropertyOneWay(name, type, decorator, log, program);
      break;
    case COMPONENT_STORAGE_PROP_DECORATOR:
    case COMPONENT_STORAGE_LINK_DECORATOR:
      const setFuncName: string = decorator === COMPONENT_STORAGE_PROP_DECORATOR ?
        APP_STORAGE_SET_AND_PROP : APP_STORAGE_SET_AND_LINK;
      updateState = updateStoragePropAndLinkProperty(node, name, setFuncName, log);
      break;
    case COMPONENT_OBJECT_LINK_DECORATOR:
      updateState = updateSynchedPropertyNesedObject(name, type, decorator, log);
      break;
    case COMPONENT_CONSUME_DECORATOR:
      wrongDecoratorInPreview(node, COMPONENT_CONSUME_DECORATOR, hasPreview, log);
      updateState = updateConsumeProperty(node, name);
      break;
  }
  return updateState;
}

function wrongDecoratorInPreview(node: ts.PropertyDeclaration, decorator: string,
  hasPreview: boolean, log: LogInfo[]) {
  if (hasPreview) {
    log.push({
      type: LogType.WARN,
      message: `The variable with ${decorator} in component with @Preview may ` +
        `cause error in component preview mode`,
      pos: node.getStart()
    });
  }
}

function createUpdateParams(name: ts.Identifier, decorator: string): ts.Statement {
  let updateParamsNode: ts.Statement;
  switch (decorator) {
    case COMPONENT_NON_DECORATOR:
    case COMPONENT_STATE_DECORATOR:
    case COMPONENT_PROVIDE_DECORATOR:
      updateParamsNode = createUpdateParamsWithIf(name);
      break;
    case COMPONENT_PROP_DECORATOR:
      updateParamsNode = createUpdateParamsWithoutIf(name);
      break;
    case COMPONENT_OBJECT_LINK_DECORATOR:
      updateParamsNode = createUpdateParamsWithSet(name);
      break;
    case COMPONENT_BUILDERPARAM_DECORATOR:
      if (decorator === COMPONENT_BUILDERPARAM_DECORATOR) {
        if (!builderParamObjectCollection.get(componentCollection.currentClassName)) {
          builderParamObjectCollection.set(componentCollection.currentClassName, new Set([]));
        }
        builderParamObjectCollection.get(componentCollection.currentClassName)
          .add(name.escapedText.toString())
      }
      updateParamsNode = createUpdateParamsWithoutIf(name, true);
      break;
  }
  return updateParamsNode;
}

function createUpdateParamsWithIf(name: ts.Identifier): ts.IfStatement {
  return ts.factory.createIfStatement(ts.factory.createBinaryExpression(
    ts.factory.createPropertyAccessExpression(
      ts.factory.createIdentifier(CREATE_CONSTRUCTOR_PARAMS),
      ts.factory.createIdentifier(name.escapedText.toString())),
    ts.factory.createToken(ts.SyntaxKind.ExclamationEqualsEqualsToken),
    ts.factory.createIdentifier(COMPONENT_CONSTRUCTOR_UNDEFINED)), ts.factory.createBlock([
    createUpdateParamsWithoutIf(name)], true), undefined);
}

function createUpdateParamsWithoutIf(name: ts.Identifier, isAdd: boolean = false): ts.ExpressionStatement {
  return ts.factory.createExpressionStatement(ts.factory.createBinaryExpression(
    createPropertyAccessExpressionWithThis(name.getText()),
    ts.factory.createToken(ts.SyntaxKind.EqualsToken),
    createPropertyAccessExpressionWithParams(name.getText())));
}

function createUpdateParamsWithSet(name: ts.Identifier): ts.ExpressionStatement {
  return ts.factory.createExpressionStatement(ts.factory.createCallExpression(
    ts.factory.createPropertyAccessExpression(createPropertyAccessExpressionWithThis(`__${name.getText()}`),
      ts.factory.createIdentifier(CREATE_SET_METHOD)), undefined,
    [createPropertyAccessExpressionWithParams(name.getText())]));
}

function updateNormalProperty(node: ts.PropertyDeclaration, name: ts.Identifier,
  log: LogInfo[], context: ts.TransformationContext): ts.ExpressionStatement {
  const init: ts.Expression =
    ts.visitNode(processCustomDialogController(node, log), visitDialogController);
  function visitDialogController(node: ts.Node): ts.Node {
    if (isProperty(node)) {
      node = createReference(node as ts.PropertyAssignment);
    }
    return ts.visitEachChild(node, visitDialogController, context);
  }
  return ts.factory.createExpressionStatement(ts.factory.createBinaryExpression(
    createPropertyAccessExpressionWithThis(name.getText()),
    ts.factory.createToken(ts.SyntaxKind.EqualsToken), init ||
    ts.factory.createIdentifier(COMPONENT_CONSTRUCTOR_UNDEFINED)));
}

function processCustomDialogController(node: ts.PropertyDeclaration,
  log: LogInfo[]): ts.Expression {
  if (node.initializer && ts.isNewExpression(node.initializer) &&
    ts.isIdentifier(node.initializer.expression) &&
    node.initializer.expression.getText() === SET_CONTROLLER_CTR_TYPE) {
    return createCustomDialogController(node, node.initializer, log);
  }
  return node.initializer;
}

function createCustomDialogController(parent: ts.PropertyDeclaration, node: ts.NewExpression,
  log: LogInfo[]): ts.NewExpression {
  if (node.arguments && node.arguments.length === 1 &&
    ts.isObjectLiteralExpression(node.arguments[0]) && node.arguments[0].properties) {
    const newproperties: ts.ObjectLiteralElementLike[] = node.arguments[0].properties.map((item) => {
      if (isCustomDialogControllerPropertyAssignment(item, log)) {
        item = processCustomDialogControllerPropertyAssignment(parent, item as ts.PropertyAssignment);
      }
      return item;
    });
    return ts.factory.createNewExpression(node.expression, node.typeArguments,
      [ts.factory.createObjectLiteralExpression(newproperties, true), ts.factory.createThis()]);
  }
}

function isCustomDialogControllerPropertyAssignment(node: ts.ObjectLiteralElementLike,
  log: LogInfo[]): boolean {
  if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) &&
    node.name.getText() === CUSTOM_DIALOG_CONTROLLER_BUILDER) {
    if (ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression) &&
      componentCollection.customDialogs.has(node.initializer.expression.getText())) {
      return true;
    } else {
      validateCustomDialogControllerBuilderInit(node, log);
    }
  }
}

function processCustomDialogControllerPropertyAssignment(parent: ts.PropertyDeclaration,
  node: ts.PropertyAssignment): ts.PropertyAssignment {
  if (ts.isCallExpression(node.initializer)) {
    return ts.factory.updatePropertyAssignment(node, node.name,
      processCustomDialogControllerBuilder(parent, node.initializer));
  }
}

function processCustomDialogControllerBuilder(parent: ts.PropertyDeclaration,
  node: ts.CallExpression): ts.ArrowFunction {
  const newExp: ts.Expression = createCustomComponentNewExpression(node);
  const jsDialog: ts.Identifier = ts.factory.createIdentifier(JS_DIALOG);
  return createCustomComponentBuilderArrowFunction(parent, jsDialog, newExp);
}

function updateObservedProperty(item: ts.PropertyDeclaration, name: ts.Identifier,
  type: ts.TypeNode, program: ts.Program): ts.ExpressionStatement {
  return ts.factory.createExpressionStatement(ts.factory.createBinaryExpression(
    createPropertyAccessExpressionWithThis(`__${name.getText()}`),
    ts.factory.createToken(ts.SyntaxKind.EqualsToken), ts.factory.createNewExpression(
      ts.factory.createIdentifier(isSimpleType(type, program) ? OBSERVED_PROPERTY_SIMPLE :
        OBSERVED_PROPERTY_OBJECT), undefined, [item.initializer, ts.factory.createThis(),
        ts.factory.createStringLiteral(name.escapedText.toString())])));
}

function updateSynchedPropertyTwoWay(nameIdentifier: ts.Identifier, type: ts.TypeNode,
  program: ts.Program): ts.ExpressionStatement {
  const name: string = nameIdentifier.escapedText.toString();
  const functionName: string = isSimpleType(type, program) ?
    SYNCHED_PROPERTY_SIMPLE_TWO_WAY : SYNCHED_PROPERTY_OBJECT_TWO_WAY;
  return createInitExpressionStatementForDecorator(name, functionName,
    createPropertyAccessExpressionWithParams(name));
}

function updateSynchedPropertyOneWay(nameIdentifier: ts.Identifier, type: ts.TypeNode,
  decoractor: string, log: LogInfo[], program: ts.Program): ts.ExpressionStatement {
  const name: string = nameIdentifier.escapedText.toString();
  if (isSimpleType(type, program)) {
    return createInitExpressionStatementForDecorator(name, SYNCHED_PROPERTY_SIMPLE_ONE_WAY,
      createPropertyAccessExpressionWithParams(name));
  } else {
    validateNonSimpleType(nameIdentifier, decoractor, log);
  }
}

function updateStoragePropAndLinkProperty(node: ts.PropertyDeclaration, name: ts.Identifier,
  setFuncName: string, log: LogInfo[]): ts.ExpressionStatement {
  if (isSingleKey(node)) {
    const key: string = getDecoratorKey(node);
    return ts.factory.createExpressionStatement(ts.factory.createBinaryExpression(
      createPropertyAccessExpressionWithThis(`__${name.getText()}`),
      ts.factory.createToken(ts.SyntaxKind.EqualsToken), ts.factory.createCallExpression(
        ts.factory.createPropertyAccessExpression(ts.factory.createCallExpression(
          ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(APP_STORAGE),
            ts.factory.createIdentifier(APP_STORAGE_GET_OR_SET)), undefined, []),
        ts.factory.createIdentifier(setFuncName)), undefined, [ts.factory.createStringLiteral(key),
          node.initializer, ts.factory.createThis()])));
  } else {
    validateAppStorageDecoractorsNonSingleKey(node, log);
  }
}

function getDecoratorKey(node: ts.PropertyDeclaration): string {
  let key: string;
  // @ts-ignore
  const keyNameNode: ts.Node = node.decorators[0].expression.arguments[0];
  if (ts.isIdentifier(keyNameNode)) {
    key = keyNameNode.getText();
    decoratorParamSet.add(key);
  } else if (ts.isStringLiteral(keyNameNode)) {
    key = keyNameNode.text;
  }
  return key;
}

function updateSynchedPropertyNesedObject(nameIdentifier: ts.Identifier,
  type: ts.TypeNode, decoractor: string, log: LogInfo[]): ts.ExpressionStatement {
  if (isObservedClassType(type)) {
    return createInitExpressionStatementForDecorator(nameIdentifier.getText(), SYNCHED_PROPERTY_NESED_OBJECT,
      createPropertyAccessExpressionWithParams(nameIdentifier.getText()));
  } else {
    validateNonObservedClassType(nameIdentifier, decoractor, log);
  }
}

function updateConsumeProperty(node: ts.PropertyDeclaration,
  nameIdentifier: ts.Identifier): ts.ExpressionStatement {
  const name: string = nameIdentifier.getText();
  let propertyOrAliasName: string;
  if (isSingleKey(node)) {
    propertyOrAliasName = getDecoratorKey(node);
  } else {
    propertyOrAliasName = name;
  }
  return ts.factory.createExpressionStatement(ts.factory.createBinaryExpression(
    createPropertyAccessExpressionWithThis(`__${name}`),
    ts.factory.createToken(ts.SyntaxKind.EqualsToken), ts.factory.createCallExpression(
      createPropertyAccessExpressionWithThis(INITIALIZE_CONSUME_FUNCTION), undefined, [
        ts.factory.createStringLiteral(propertyOrAliasName), ts.factory.createStringLiteral(name)])));
}

function createCustomComponentBuilderArrowFunction(parent: ts.PropertyDeclaration,
  jsDialog: ts.Identifier, newExp: ts.Expression): ts.ArrowFunction {
  return ts.factory.createArrowFunction(undefined, undefined, [], undefined,
    ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken), ts.factory.createBlock([
      ts.factory.createVariableStatement(undefined, ts.factory.createVariableDeclarationList(
        [ts.factory.createVariableDeclaration(jsDialog, undefined, undefined, newExp)],
        ts.NodeFlags.Let)), ts.factory.createExpressionStatement(ts.factory.createCallExpression(
        ts.factory.createPropertyAccessExpression(jsDialog,
          ts.factory.createIdentifier(SET_CONTROLLER_METHOD)), undefined,
        [ts.factory.createPropertyAccessExpression(ts.factory.createThis(),
            parent.name as ts.Identifier)])), ts.factory.createExpressionStatement(
        createViewCreate(jsDialog))], true));
}

export function createViewCreate(node: ts.NewExpression | ts.Identifier): ts.CallExpression {
  return createFunction(ts.factory.createIdentifier(BASE_COMPONENT_NAME),
    ts.factory.createIdentifier(COMPONENT_CREATE_FUNCTION), ts.factory.createNodeArray([node]));
}

export function createCustomComponentNewExpression(node: ts.CallExpression): ts.NewExpression {
  const newNode: ts.NewExpression = ts.factory.createNewExpression(node.expression,
    node.typeArguments, node.arguments.length ? node.arguments : []);
  return addCustomComponentId(newNode);
}

function addCustomComponentId(node: ts.NewExpression): ts.NewExpression {
  for (const item of componentCollection.customComponents) {
    componentInfo.componentNames.add(item);
  }
  componentInfo.componentNames.forEach((name: string) => {
    const nodeIdentifier: ts.Identifier | ts.PropertyAccessExpression =
      node.expression as ts.Identifier | ts.PropertyAccessExpression;
    let argumentsArray: ts.Expression[];
    if (node.arguments && node.arguments.length) {
      argumentsArray = Array.from(node.arguments);
    }
    if (nodeIdentifier && (ts.isIdentifier(nodeIdentifier) &&
      nodeIdentifier.escapedText === name || ts.isPropertyAccessExpression(nodeIdentifier) &&
      ts.isIdentifier(nodeIdentifier.name) && nodeIdentifier.name.escapedText === name)) {
      if (!argumentsArray) {
        argumentsArray = [ts.factory.createObjectLiteralExpression([], true)];
      }
      argumentsArray.unshift(ts.factory.createStringLiteral((++componentInfo.id).toString()),
        ts.factory.createThis());
      node =
        ts.factory.updateNewExpression(node, node.expression, node.typeArguments, argumentsArray);
    } else if (argumentsArray) {
      node =
        ts.factory.updateNewExpression(node, node.expression, node.typeArguments, argumentsArray);
    }
  });
  return node;
}

function createInitExpressionStatementForDecorator(propertyName: string, functionName: string,
  parameterNode: ts.Expression): ts.ExpressionStatement {
  return ts.factory.createExpressionStatement(ts.factory.createBinaryExpression(
    createPropertyAccessExpressionWithThis(`__${propertyName}`),
    ts.factory.createToken(ts.SyntaxKind.EqualsToken), ts.factory.createNewExpression(
      ts.factory.createIdentifier(functionName), undefined, [parameterNode, ts.factory.createThis(),
        ts.factory.createStringLiteral(propertyName)])));
}

function createPropertyAccessExpressionWithParams(propertyName: string): ts.PropertyAccessExpression {
  return ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(CREATE_CONSTRUCTOR_PARAMS),
    ts.factory.createIdentifier(propertyName));
}

function createPropertyAccessExpressionWithThis(propertyName: string): ts.PropertyAccessExpression {
  return ts.factory.createPropertyAccessExpression(ts.factory.createThis(),
    ts.factory.createIdentifier(propertyName));
}

function addAddProvidedVar(node: ts.PropertyDeclaration, name: ts.Identifier,
  decoratorName: string, updateState: ts.Statement[]): void {
  if (decoratorName === COMPONENT_PROVIDE_DECORATOR) {
    if (isSingleKey(node)) {
      updateState.push(createAddProvidedVar(getDecoratorKey(node), name));
    }
    updateState.push(createAddProvidedVar(name.getText(), name));
  }
}

function createAddProvidedVar(propertyOrAliasName: string,
  name: ts.Identifier): ts.ExpressionStatement {
  return ts.factory.createExpressionStatement(ts.factory.createCallExpression(
    createPropertyAccessExpressionWithThis(ADD_PROVIDED_VAR), undefined, [
      ts.factory.createStringLiteral(propertyOrAliasName),
      createPropertyAccessExpressionWithThis(`__${name.getText()}`)]));
}

function createGetAccessor(item: ts.Identifier, express: string): ts.GetAccessorDeclaration {
  const getAccessorStatement: ts.GetAccessorDeclaration =
    ts.factory.createGetAccessorDeclaration(undefined, undefined, item, [], undefined,
      ts.factory.createBlock([ts.factory.createReturnStatement(
        ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(
          createPropertyAccessExpressionWithThis(`__${item.getText()}`),
          ts.factory.createIdentifier(express)), undefined, []))], true));
  return getAccessorStatement;
}

function createSetAccessor(item: ts.Identifier, express: string): ts.SetAccessorDeclaration {
  const setAccessorStatement: ts.SetAccessorDeclaration =
    ts.factory.createSetAccessorDeclaration(undefined, undefined, item,
      [ts.factory.createParameterDeclaration(undefined, undefined, undefined,
        ts.factory.createIdentifier(CREATE_NEWVALUE_IDENTIFIER), undefined, undefined,
        undefined)], ts.factory.createBlock([ts.factory.createExpressionStatement(
        ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(
          createPropertyAccessExpressionWithThis(`__${item.getText()}`),
          ts.factory.createIdentifier(express)), undefined,
        [ts.factory.createIdentifier(CREATE_NEWVALUE_IDENTIFIER)]))], true));
  return setAccessorStatement;
}

function isForbiddenUseStateType(typeNode: ts.TypeNode): boolean {
  if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName) &&
    forbiddenUseStateType.has(typeNode.typeName.getText())) {
    return true;
  }
  return false;
}

function isSimpleType(typeNode: ts.TypeNode, program: ts.Program): boolean {
  let checker: ts.TypeChecker;
  if (program) {
    checker = program.getTypeChecker();
  }
  const enumType: ts.SyntaxKind = getEnumType(typeNode, checker);
  if (simpleTypes.has(enumType || typeNode.kind) || isEnumtype(typeNode)) {
    return true;
  } else if (ts.isUnionTypeNode(typeNode) && typeNode.types) {
    const types: ts.NodeArray<ts.TypeNode> = typeNode.types;
    for (let i = 0; i < types.length; i++) {
      const enumType: ts.SyntaxKind = getEnumType(types[i], checker);
      if (!simpleTypes.has(enumType || types[i].kind) && !isEnumtype(typeNode)) {
        return false;
      }
    }
    return true;
  }
  return false;
}

function getEnumType(typeNode: ts.TypeNode, checker: ts.TypeChecker): ts.SyntaxKind {
  if (!checker) {
    return;
  }
  if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    const type: ts.Type =
      checker.getBaseTypeOfLiteralType(checker.getTypeAtLocation(typeNode.typeName));
    if (type.symbol && type.symbol.valueDeclaration) {
      return type.symbol.valueDeclaration.kind;
    }
  }
}

function isEnumtype(typeNode: ts.TypeNode): boolean {
  if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    return enumCollection.has(typeNode.typeName.getText());
  }
}

function isObservedClassType(type: ts.TypeNode): boolean {
  if (ts.isTypeReferenceNode(type) && observedClassCollection.has(type.getText())) {
    return true;
  } else if (ts.isUnionTypeNode(type) && type.types) {
    const types: ts.NodeArray<ts.TypeNode> = type.types;
    for (let i = 0; i < types.length; i++) {
      if (!observedClassCollection.has(types[i].getText())) {
        return false;
      }
    }
    return true;
  }
  return false;
}

function validateAppStorageDecoractorsNonSingleKey(node: ts.PropertyDeclaration,
  log: LogInfo[]): void {
  if (ts.isIdentifier(node.decorators[0].expression)) {
    validateDecoratorNonSingleKey(node.decorators[0].expression, log);
  } else if (ts.isCallExpression(node.decorators[0].expression) &&
    ts.isIdentifier(node.decorators[0].expression.expression)) {
    validateDecoratorNonSingleKey(node.decorators[0].expression.expression, log);
  }
}

function isSingleKey(node: ts.PropertyDeclaration): boolean {
  if (ts.isCallExpression(node.decorators[0].expression) &&
  node.decorators[0].expression.arguments &&
  node.decorators[0].expression.arguments.length === 1 &&
  (ts.isIdentifier(node.decorators[0].expression.arguments[0]) ||
  ts.isStringLiteral(node.decorators[0].expression.arguments[0]))) {
    return true;
  }
}

function validateMultiDecorators(name: ts.Identifier, log: LogInfo[]): void {
  log.push({
    type: LogType.ERROR,
    message: `The property '${name.escapedText.toString()}' cannot have mutilate state management decorators.`,
    pos: name.getStart()
  });
}

function validateDecoratorNonSingleKey(decoratorsIdentifier: ts.Identifier,
  log: LogInfo[]): void {
  log.push({
    type: LogType.ERROR,
    message: `The decorator ${decoratorsIdentifier.escapedText.toString()} should have a single key.`,
    pos: decoratorsIdentifier.getStart()
  });
}

function validatePropertyNonDefaultValue(propertyName: ts.Identifier, decorator: string,
  log: LogInfo[]): void {
  log.push({
    type: LogType.ERROR,
    message: `The ${decorator} property '${propertyName.getText()}' must be specified a default value.`,
    pos: propertyName.getStart()
  });
}

function validatePropertyDefaultValue(propertyName: ts.Identifier, decorator: string,
  log: LogInfo[]): void {
  log.push({
    type: LogType.ERROR,
    message: `The ${decorator} property '${propertyName.getText()}' cannot be specified a default value.`,
    pos: propertyName.getStart()
  });
}

function validatePropertyNonType(propertyName: ts.Identifier, log: LogInfo[]): void {
  log.push({
    type: LogType.ERROR,
    message: `The property '${propertyName.getText()}' must specify a type.`,
    pos: propertyName.getStart()
  });
}

function validateNonSimpleType(propertyName: ts.Identifier, decorator: string,
  log: LogInfo[]): void {
  log.push({
    type: LogType.ERROR,
    message: `The type of the ${decorator} property '${propertyName.getText()}' ` +
      `can only be string, number or boolean.`,
    pos: propertyName.getStart()
  });
}

function validateNonObservedClassType(propertyName: ts.Identifier, decorator: string,
  log: LogInfo[]): void {
  log.push({
    type: LogType.ERROR,
    message: `The type of the ${decorator} property '${propertyName.getText()}' can only be ` +
      `objects of classes decorated with ${COMPONENT_OBSERVED_DECORATOR} class decorator in ets (not ts).`,
    pos: propertyName.getStart()
  });
}

function validateHasIllegalQuestionToken(propertyName: ts.Identifier, decorator: string,
  log: LogInfo[]): void {
  log.push({
    type: LogType.WARN,
    message: `The ${decorator} property '${propertyName.getText()}' cannot be an optional parameter.`,
    pos: propertyName.getStart()
  });
}

function validateHasIllegalDecoratorInEntry(parentName: ts.Identifier, propertyName: ts.Identifier,
  decorator: string, log: LogInfo[]): void {
  log.push({
    type: LogType.WARN,
    message: `The @Entry component '${parentName.getText()}' cannot have the ` +
      `${decorator} property '${propertyName.getText()}'.`,
    pos: propertyName.getStart()
  });
}

function validateForbiddenUseStateType(propertyName: ts.Identifier, decorator: string, type: string,
  log: LogInfo[]): void {
  log.push({
    type: LogType.ERROR,
    message: `The ${decorator} property '${propertyName.getText()}' cannot be a '${type}' object.`,
    pos: propertyName.getStart()
  });
}

function validateDuplicateDecorator(decorator: ts.Decorator, log: LogInfo[]): void {
  log.push({
    type: LogType.ERROR,
    message: `The decorator '${decorator.getText()}' cannot have the same name as the build-in ` +
      `style attribute '${decorator.getText().replace('@', '')}'.`,
    pos: decorator.getStart()
  });
}

function validateWatchDecorator(propertyName: ts.Identifier, length: number, log: LogInfo[]): boolean {
  if (length === 1) {
    log.push({
      type: LogType.ERROR,
      message: `Regular variable '${propertyName.escapedText.toString()}' can not be decorated with @Watch.`,
      pos: propertyName.getStart()
    });
    return false;
  }
  return true;
}

function validateWatchParam(type: LogType, pos: number, log: LogInfo[]): void {
  log.push({
    type: type,
    message: 'The parameter should be a string.',
    pos: pos
  });
}

function validateCustomDialogControllerBuilderInit(node: ts.ObjectLiteralElementLike,
  log: LogInfo[]): void {
  log.push({
    type: LogType.ERROR,
    message: 'The builder should be initialized with a @CustomDialog Component.',
    pos: node.getStart()
  });
}
