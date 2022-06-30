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
  COMPONENT_STATE_DECORATOR,
  COMPONENT_PROVIDE_DECORATOR,
  COMPONENT_LINK_DECORATOR,
  COMPONENT_PROP_DECORATOR,
  COMPONENT_STORAGE_LINK_DECORATOR,
  COMPONENT_STORAGE_PROP_DECORATOR,
  COMPONENT_OBJECT_LINK_DECORATOR,
  COMPONENT_CONSUME_DECORATOR,
  SYNCHED_PROPERTY_NESED_OBJECT,
  SYNCHED_PROPERTY_SIMPLE_TWO_WAY,
  SYNCHED_PROPERTY_SIMPLE_ONE_WAY,
  OBSERVED_PROPERTY_OBJECT,
  OBSERVED_PROPERTY_SIMPLE,
  COMPONENT_BUILD_FUNCTION,
  BASE_COMPONENT_NAME,
  CREATE_CONSTRUCTOR_PARAMS,
  COMPONENT_CONSTRUCTOR_UPDATE_PARAMS,
  COMPONENT_CONSTRUCTOR_DELETE_PARAMS,
  COMPONENT_DECORATOR_PREVIEW,
  CREATE_CONSTRUCTOR_SUBSCRIBER_MANAGER,
  ABOUT_TO_BE_DELETE_FUNCTION_ID,
  CREATE_CONSTRUCTOR_GET_FUNCTION,
  CREATE_CONSTRUCTOR_DELETE_FUNCTION,
  FOREACH_OBSERVED_OBJECT,
  FOREACH_GET_RAW_OBJECT,
  COMPONENT_BUILDER_DECORATOR,
  COMPONENT_TRANSITION_FUNCTION,
  COMPONENT_CREATE_FUNCTION,
  GEOMETRY_VIEW,
  COMPONENT_STYLES_DECORATOR,
  STYLES,
  INTERFACE_NAME_SUFFIX,
  OBSERVED_PROPERTY_ABSTRACT,
  COMPONENT_LOCAL_STORAGE_LINK_DECORATOR,
  COMPONENT_LOCAL_STORAGE_PROP_DECORATOR,
  COMPONENT_CONSTRUCTOR_LOCALSTORAGE,
  COMPONENT_SET_AND_LINK,
  COMPONENT_SET_AND_PROP,
  COMPONENT_CONSTRUCTOR_UNDEFINED,
  CUSTOM_COMPONENT
} from './pre_define';
import {
  BUILDIN_STYLE_NAMES,
  CUSTOM_BUILDER_METHOD,
  INNER_STYLE_FUNCTION,
  INTERFACE_NODE_SET,
  STYLES_ATTRIBUTE
} from './component_map';
import {
  componentCollection,
  linkCollection,
  localStorageLinkCollection,
  localStoragePropCollection
} from './validate_ui_syntax';
import {
  addConstructor,
  getInitConstructor
} from './process_component_constructor';
import {
  ControllerType,
  processMemberVariableDecorators,
  UpdateResult,
  stateObjectCollection,
  curPropMap,
  decoratorParamSet,
  isSimpleType
} from './process_component_member';
import {
  processComponentBuild,
  processComponentBlock
} from './process_component_build';
import {
  LogType,
  LogInfo,
  hasDecorator
} from './utils';

export function processComponentClass(node: ts.StructDeclaration, context: ts.TransformationContext,
  log: LogInfo[], program: ts.Program): ts.ClassDeclaration {
  const memberNode: ts.ClassElement[] =
    processMembers(node.members, node.name, context, log, program, checkPreview(node));
  return ts.factory.createClassDeclaration(undefined, node.modifiers, node.name,
    node.typeParameters, updateHeritageClauses(node, log), memberNode);
}

function checkPreview(node: ts.ClassDeclaration) {
  let hasPreview: boolean = false;
  if (node && node.decorators) {
    for (let i = 0; i < node.decorators.length; i++) {
      const name: string = node.decorators[i].getText().replace(/\([^\(\)]*\)/, '').trim();
      if (name === COMPONENT_DECORATOR_PREVIEW) {
        hasPreview = true;
        break;
      }
    }
  }
  return hasPreview;
}

type BuildCount = {
  count: number;
}

function processMembers(members: ts.NodeArray<ts.ClassElement>, parentComponentName: ts.Identifier,
  context: ts.TransformationContext, log: LogInfo[], program: ts.Program, hasPreview: boolean): ts.ClassElement[] {
  const buildCount: BuildCount = { count: 0 };
  let ctorNode: any = getInitConstructor(members, parentComponentName);
  const newMembers: ts.ClassElement[] = [];
  const watchMap: Map<string, ts.Node> = new Map();
  const updateParamsStatements: ts.Statement[] = [];
  const deleteParamsStatements: ts.PropertyDeclaration[] = [];
  const checkController: ControllerType =
    { hasController: !componentCollection.customDialogs.has(parentComponentName.getText()) };
  const interfaceNode = ts.factory.createInterfaceDeclaration(undefined, undefined,
    parentComponentName.getText() + INTERFACE_NAME_SUFFIX, undefined, undefined, []);
  members.forEach((item: ts.ClassElement) => {
    let updateItem: ts.ClassElement;
    if (ts.isPropertyDeclaration(item)) {
      addPropertyMember(item, newMembers, program, parentComponentName.getText());
      const result: UpdateResult = processMemberVariableDecorators(parentComponentName, item,
        ctorNode, watchMap, checkController, log, program, context, hasPreview, interfaceNode);
      if (result.isItemUpdate()) {
        updateItem = result.getProperity();
      } else {
        updateItem = item;
      }
      if (result.getVariableGet()) {
        newMembers.push(result.getVariableGet());
      }
      if (result.getVariableSet()) {
        newMembers.push(result.getVariableSet());
      }
      if (result.isCtorUpdate()) {
        ctorNode = result.getCtor();
      }
      if (result.getUpdateParams()) {
        updateParamsStatements.push(result.getUpdateParams());
      }
      if (result.isDeleteParams()) {
        deleteParamsStatements.push(item);
      }
      if (result.getControllerSet()) {
        newMembers.push(result.getControllerSet());
      }
    }
    if (ts.isMethodDeclaration(item) && item.name) {
      updateItem =
        processComponentMethod(item, parentComponentName, context, log, buildCount);
    }
    if (updateItem) {
      newMembers.push(updateItem);
    }
  });
  INTERFACE_NODE_SET.add(interfaceNode);
  validateBuildMethodCount(buildCount, parentComponentName, log);
  validateHasController(parentComponentName, checkController, log);
  newMembers.unshift(addDeleteParamsFunc(deleteParamsStatements));
  newMembers.unshift(addUpdateParamsFunc(updateParamsStatements, parentComponentName));
  newMembers.unshift(addConstructor(ctorNode, watchMap, parentComponentName));
  return newMembers;
}

function addPropertyMember(item: ts.ClassElement, newMembers: ts.ClassElement[],
  program: ts.Program, parentComponentName: string): void {
  const propertyItem: ts.PropertyDeclaration = item as ts.PropertyDeclaration;
  let decoratorName: string;
  let updatePropertyItem: ts.PropertyDeclaration;
  const type: ts.TypeNode = propertyItem.type;
  if (!propertyItem.decorators || propertyItem.decorators.length === 0) {
    updatePropertyItem = createPropertyDeclaration(propertyItem, type, true);
    newMembers.push(updatePropertyItem);
  } else if (propertyItem.decorators) {
    for (let i = 0; i < propertyItem.decorators.length; i++) {
      let newType: ts.TypeNode;
      decoratorName = propertyItem.decorators[i].getText().replace(/\(.*\)$/, '').trim();
      let isLocalStorage: boolean = false;
      switch (decoratorName) {
        case COMPONENT_STATE_DECORATOR:
        case COMPONENT_PROVIDE_DECORATOR:
          newType = ts.factory.createTypeReferenceNode(isSimpleType(type, program) ?
            OBSERVED_PROPERTY_SIMPLE : OBSERVED_PROPERTY_OBJECT, [type ||
              ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)]);
          break;
        case COMPONENT_LINK_DECORATOR:
        case COMPONENT_CONSUME_DECORATOR:
          newType = ts.factory.createTypeReferenceNode(isSimpleType(type, program) ?
            SYNCHED_PROPERTY_SIMPLE_TWO_WAY : SYNCHED_PROPERTY_SIMPLE_ONE_WAY, [type ||
              ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)]);
          break;
        case COMPONENT_PROP_DECORATOR:
          newType = ts.factory.createTypeReferenceNode(SYNCHED_PROPERTY_SIMPLE_ONE_WAY, [type ||
            ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)]);
          break;
        case COMPONENT_OBJECT_LINK_DECORATOR:
          newType = ts.factory.createTypeReferenceNode(SYNCHED_PROPERTY_NESED_OBJECT, [type ||
            ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)]);
          break;
        case COMPONENT_STORAGE_PROP_DECORATOR:
        case COMPONENT_STORAGE_LINK_DECORATOR:
          newType = ts.factory.createTypeReferenceNode(OBSERVED_PROPERTY_ABSTRACT, [type ||
            ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)]);
          break;
        case COMPONENT_LOCAL_STORAGE_LINK_DECORATOR:
        case COMPONENT_LOCAL_STORAGE_PROP_DECORATOR:
          newType = ts.factory.createTypeReferenceNode(OBSERVED_PROPERTY_ABSTRACT, [type ||
            ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)]);
          isLocalStorage = true;
          break;
      }
      updatePropertyItem = createPropertyDeclaration(propertyItem, newType, false,
        isLocalStorage, parentComponentName);
      if (updatePropertyItem) {
        newMembers.push(updatePropertyItem);
      }
    }
  }
}

function createPropertyDeclaration(propertyItem: ts.PropertyDeclaration, newType: ts.TypeNode | undefined,
  normalVar: boolean, isLocalStorage: boolean = false, parentComponentName: string = null): ts.PropertyDeclaration {
  if (typeof newType === undefined) {
    return undefined;
  }
  let prefix: string = '';
  if (!normalVar) {
    prefix = '__';
  }
  const privateM: ts.ModifierToken<ts.SyntaxKind.PrivateKeyword> =
    ts.factory.createModifier(ts.SyntaxKind.PrivateKeyword);
  return ts.factory.updatePropertyDeclaration(propertyItem, undefined,
    propertyItem.modifiers || [privateM], prefix + propertyItem.name.getText(),
    propertyItem.questionToken, newType, isLocalStorage ?
      createLocalStroageCallExpression(propertyItem, propertyItem.name.getText(),
        parentComponentName) : undefined);
}

function createLocalStroageCallExpression(node: ts.PropertyDeclaration, name: string,
  parentComponentName: string): ts.CallExpression {
  const localStorageLink: Set<string> = localStorageLinkCollection.get(parentComponentName).get(name);
  const localStorageProp: Set<string> = localStoragePropCollection.get(parentComponentName).get(name);
  return ts.factory.createCallExpression(
    ts.factory.createPropertyAccessExpression(
      ts.factory.createPropertyAccessExpression(
        ts.factory.createThis(),
        ts.factory.createIdentifier(`${COMPONENT_CONSTRUCTOR_LOCALSTORAGE}_`)
      ),
      ts.factory.createIdentifier(localStorageLink && !localStorageProp ? COMPONENT_SET_AND_LINK :
        COMPONENT_SET_AND_PROP)
    ),
    [node.type],
    [
      ts.factory.createStringLiteral(localStorageLink && !localStorageProp ?
        Array.from(localStorageLink)[0] : !localStorageLink && localStorageProp ?
          Array.from(localStorageProp)[0] : COMPONENT_CONSTRUCTOR_UNDEFINED),
      ts.factory.createNumericLiteral(node.initializer ? node.initializer.getText() :
        COMPONENT_CONSTRUCTOR_UNDEFINED), ts.factory.createThis(),
      ts.factory.createStringLiteral(name || COMPONENT_CONSTRUCTOR_UNDEFINED)
    ]
  );
}

function processComponentMethod(node: ts.MethodDeclaration, parentComponentName: ts.Identifier,
  context: ts.TransformationContext, log: LogInfo[], buildCount: BuildCount): ts.MethodDeclaration {
  let updateItem: ts.MethodDeclaration = node;
  const name: string = node.name.getText();
  if (name === COMPONENT_BUILD_FUNCTION) {
    buildCount.count = buildCount.count + 1;
    if (node.parameters.length) {
      log.push({
        type: LogType.ERROR,
        message: `The 'build' method can not have arguments.`,
        pos: node.getStart()
      });
    }
    const buildNode: ts.MethodDeclaration = processComponentBuild(node, log);
    updateItem = processBuildMember(buildNode, context, log);
    curPropMap.clear();
  } else if (node.body && ts.isBlock(node.body)) {
    if (name === COMPONENT_TRANSITION_FUNCTION) {
      updateItem = ts.factory.updateMethodDeclaration(node, node.decorators, node.modifiers,
        node.asteriskToken, node.name, node.questionToken, node.typeParameters, node.parameters,
        node.type, processComponentBlock(node.body, false, log, true));
    } else if (hasDecorator(node, COMPONENT_BUILDER_DECORATOR)) {
      CUSTOM_BUILDER_METHOD.add(name);
      const builderNode: ts.MethodDeclaration = ts.factory.updateMethodDeclaration(node, undefined, node.modifiers,
        node.asteriskToken, node.name, node.questionToken, node.typeParameters, node.parameters,
        node.type, processComponentBlock(node.body, false, log));
      updateItem = processBuildMember(builderNode, context, log);
    } else if (hasDecorator(node, COMPONENT_STYLES_DECORATOR)) {
      if (node.parameters && node.parameters.length === 0) {
        INNER_STYLE_FUNCTION.set(name, node.body);
        STYLES_ATTRIBUTE.add(name);
        BUILDIN_STYLE_NAMES.add(name);
        decoratorParamSet.add(STYLES);
      } else {
        log.push({
          type: LogType.ERROR,
          message: `@Styles can't have parameters.`,
          pos: node.getStart()
        });
      }
      return;
    }
  }
  return updateItem;
}

function processBuildMember(node: ts.MethodDeclaration, context: ts.TransformationContext,
  log: LogInfo[]): ts.MethodDeclaration {
  return ts.visitNode(node, visitBuild);
  function visitBuild(node: ts.Node): ts.Node {
    if (isGeometryView(node)) {
      node = processGeometryView(node as ts.ExpressionStatement, log);
    }
    if (isProperty(node)) {
      node = createReference(node as ts.PropertyAssignment, log);
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name) &&
      stateObjectCollection.has(checkStateName(node)) && node.parent && ts.isCallExpression(node.parent) &&
      ts.isPropertyAccessExpression(node.parent.expression) &&
      node.parent.expression.name.escapedText.toString() !== FOREACH_GET_RAW_OBJECT) {
      return ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(
        ts.factory.createIdentifier(FOREACH_OBSERVED_OBJECT),
        ts.factory.createIdentifier(FOREACH_GET_RAW_OBJECT)), undefined, [node]);
    }
    return ts.visitEachChild(node, visitBuild, context);
  }
  function checkStateName(node: ts.PropertyAccessExpression): string {
    if (node.expression && !node.expression.expression && node.name && ts.isIdentifier(node.name)) {
      return node.name.escapedText.toString();
    }
    return null;
  }
}

function isGeometryView(node: ts.Node): boolean {
  if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
    const call: ts.CallExpression = node.expression;
    const exp: ts.Expression = call.expression;
    const args: ts.NodeArray<ts.Expression> = call.arguments;
    if (ts.isPropertyAccessExpression(exp) && ts.isIdentifier(exp.expression) &&
      exp.expression.escapedText.toString() === GEOMETRY_VIEW && ts.isIdentifier(exp.name) &&
      exp.name.escapedText.toString() === COMPONENT_CREATE_FUNCTION && args && args.length === 1 &&
      (ts.isArrowFunction(args[0]) || ts.isFunctionExpression(args[0]))) {
      return true;
    }
  }
  return false;
}

function processGeometryView(node: ts.ExpressionStatement,
  log: LogInfo[]): ts.ExpressionStatement {
  const exp: ts.CallExpression = node.expression as ts.CallExpression;
  const arg: ts.ArrowFunction | ts.FunctionExpression =
    exp.arguments[0] as ts.ArrowFunction | ts.FunctionExpression;
  return ts.factory.updateExpressionStatement(node, ts.factory.updateCallExpression(exp,
    exp.expression, undefined, [ts.factory.createArrowFunction(undefined, undefined, arg.parameters,
      undefined, ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      getGeometryReaderFunctionBlock(arg, log))]));
}

function getGeometryReaderFunctionBlock(node: ts.ArrowFunction | ts.FunctionExpression,
  log: LogInfo[]): ts.Block {
  let blockNode: ts.Block;
  if (ts.isBlock(node.body)) {
    blockNode = node.body;
  } else if (ts.isArrowFunction(node) && ts.isCallExpression(node.body)) {
    blockNode = ts.factory.createBlock([ts.factory.createExpressionStatement(node.body)]);
  }
  return processComponentBlock(blockNode, false, log);
}

function updateHeritageClauses(node: ts.StructDeclaration, log: LogInfo[])
  : ts.NodeArray<ts.HeritageClause> {
  if (node.heritageClauses && !checkHeritageClauses(node)) {
    log.push({
      type: LogType.ERROR,
      message: 'The struct component is not allowed to extends other class or implements other interface.',
      pos: node.heritageClauses.pos
    });
  }
  const result:ts.HeritageClause[] = [];
  const heritageClause:ts.HeritageClause = ts.factory.createHeritageClause(
    ts.SyntaxKind.ExtendsKeyword,
    [ts.factory.createExpressionWithTypeArguments(
      ts.factory.createIdentifier(BASE_COMPONENT_NAME), [])]);
  result.push(heritageClause);
  return ts.factory.createNodeArray(result);
}

function checkHeritageClauses(node: ts.StructDeclaration): boolean {
  if (node.heritageClauses.length === 1 && node.heritageClauses[0].types &&
    node.heritageClauses[0].types.length === 1) {
    const expressionNode: ts.ExpressionWithTypeArguments = node.heritageClauses[0].types[0];
    if (expressionNode.expression && ts.isIdentifier(expressionNode.expression) &&
      expressionNode.expression.escapedText.toString() === CUSTOM_COMPONENT) {
      return true;
    }
  }
  return false;
}

export function isProperty(node: ts.Node): Boolean {
  if (judgmentParentType(node)) {
    if (node.parent.parent.expression && ts.isIdentifier(node.parent.parent.expression) &&
      !BUILDIN_STYLE_NAMES.has(node.parent.parent.expression.escapedText.toString()) &&
      componentCollection.customComponents.has(
        node.parent.parent.expression.escapedText.toString())) {
      return true;
    } else if (ts.isPropertyAccessExpression(node.parent.parent.expression) &&
      ts.isIdentifier(node.parent.parent.expression.expression) &&
      componentCollection.customComponents.has(
        node.parent.parent.expression.name.escapedText.toString())) {
      return true;
    }
  }
  return false;
}

function judgmentParentType(node: ts.Node): boolean {
  return ts.isPropertyAssignment(node) && node.name && ts.isIdentifier(node.name) &&
    node.parent && ts.isObjectLiteralExpression(node.parent) && node.parent.parent &&
    (ts.isCallExpression(node.parent.parent) || ts.isEtsComponentExpression(node.parent.parent));
}

export function createReference(node: ts.PropertyAssignment, log: LogInfo[]): ts.PropertyAssignment {
  const linkParentComponent: string[] = getParentNode(node, linkCollection).slice(1);
  const propertyName: ts.Identifier = node.name as ts.Identifier;
  let initText: string;
  const LINK_REG: RegExp = /^\$/g;
  const initExpression: ts.Expression = node.initializer;
  if (ts.isIdentifier(initExpression) &&
    initExpression.escapedText.toString().match(LINK_REG)) {
    initText = initExpression.escapedText.toString().replace(LINK_REG, '');
  } else if (isMatchInitExpression(initExpression) &&
    linkParentComponent.includes(propertyName.escapedText.toString())) {
    initText = initExpression.name.escapedText.toString().replace(LINK_REG, '');
    if (!initExpression.name.escapedText.toString().match(LINK_REG)) {
      log.push({
        type: LogType.WARN,
        message: `The @Link property should initialze using "$" to create a reference.`,
        pos: initExpression.getStart()
      });
    }
  }
  if (initText) {
    node = addDoubleUnderline(node, propertyName, initText);
  }
  return node;
}

function isMatchInitExpression(initExpression: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(initExpression) &&
    initExpression.expression &&
    initExpression.expression.kind === ts.SyntaxKind.ThisKeyword &&
    ts.isIdentifier(initExpression.name);
}

function addDoubleUnderline(node: ts.PropertyAssignment, propertyName: ts.Identifier,
  initText: string): ts.PropertyAssignment {
  return ts.factory.updatePropertyAssignment(node, propertyName,
    ts.factory.createPropertyAccessExpression(ts.factory.createThis(),
      ts.factory.createIdentifier(`__${initText}`)));
}

function getParentNode(node: ts.PropertyAssignment, collection: Map<string, Set<string>>): string[] {
  const grandparentNode: ts.NewExpression = node.parent.parent as ts.NewExpression;
  const grandparentExpression: ts.Identifier | ts.PropertyAccessExpression =
    grandparentNode.expression as ts.Identifier | ts.PropertyAccessExpression;
  let parentComponent: Set<string> = new Set();
  let grandparentName: string;
  if (ts.isIdentifier(grandparentExpression)) {
    grandparentName = grandparentExpression.escapedText.toString();
    parentComponent = collection.get(grandparentName);
  } else if (ts.isPropertyAccessExpression(grandparentExpression)) {
    grandparentName = grandparentExpression.name.escapedText.toString();
    parentComponent = collection.get(grandparentName);
  } else {
    // ignore
  }
  if (!parentComponent) {
    parentComponent = new Set();
  }
  return [grandparentName, ...parentComponent];
}

function addUpdateParamsFunc(statements: ts.Statement[], parentComponentName: ts.Identifier):
  ts.MethodDeclaration {
  return createParamsInitBlock(COMPONENT_CONSTRUCTOR_UPDATE_PARAMS, statements, parentComponentName);
}

function addDeleteParamsFunc(statements: ts.PropertyDeclaration[]): ts.MethodDeclaration {
  const deleteStatements: ts.ExpressionStatement[] = [];
  statements.forEach((statement: ts.PropertyDeclaration) => {
    const name: ts.Identifier = statement.name as ts.Identifier;
    const paramsStatement: ts.ExpressionStatement = ts.factory.createExpressionStatement(
      ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(
        ts.factory.createPropertyAccessExpression(ts.factory.createThis(),
          ts.factory.createIdentifier(`__${name.escapedText.toString()}`)),
        ts.factory.createIdentifier(COMPONENT_CONSTRUCTOR_DELETE_PARAMS)), undefined, []));
    deleteStatements.push(paramsStatement);
  });
  const defaultStatement: ts.ExpressionStatement =
    ts.factory.createExpressionStatement(ts.factory.createCallExpression(
      ts.factory.createPropertyAccessExpression(
        ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(
          ts.factory.createIdentifier(CREATE_CONSTRUCTOR_SUBSCRIBER_MANAGER),
          ts.factory.createIdentifier(CREATE_CONSTRUCTOR_GET_FUNCTION)), undefined, []),
        ts.factory.createIdentifier(CREATE_CONSTRUCTOR_DELETE_FUNCTION)),
      undefined, [ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(
        ts.factory.createThis(), ts.factory.createIdentifier(ABOUT_TO_BE_DELETE_FUNCTION_ID)),
      undefined, [])]));
  deleteStatements.push(defaultStatement);
  const deleteParamsMethod: ts.MethodDeclaration =
    createParamsInitBlock(COMPONENT_CONSTRUCTOR_DELETE_PARAMS, deleteStatements);
  return deleteParamsMethod;
}

function createParamsInitBlock(express: string, statements: ts.Statement[],
  parentComponentName?: ts.Identifier): ts.MethodDeclaration {
  const methodDeclaration: ts.MethodDeclaration = ts.factory.createMethodDeclaration(undefined,
    undefined, undefined, ts.factory.createIdentifier(express), undefined, undefined,
    [ts.factory.createParameterDeclaration(undefined, undefined, undefined,
      express === COMPONENT_CONSTRUCTOR_DELETE_PARAMS ? undefined :
        ts.factory.createIdentifier(CREATE_CONSTRUCTOR_PARAMS), undefined,
      express === COMPONENT_CONSTRUCTOR_DELETE_PARAMS ? undefined :
        ts.factory.createTypeReferenceNode(
          ts.factory.createIdentifier(parentComponentName.getText() + INTERFACE_NAME_SUFFIX), undefined),
      undefined)], undefined, ts.factory.createBlock(statements, true));
  return methodDeclaration;
}

function validateBuildMethodCount(buildCount: BuildCount, parentComponentName: ts.Identifier,
  log: LogInfo[]): void {
  if (buildCount.count !== 1) {
    log.push({
      type: LogType.ERROR,
      message: `struct '${parentComponentName.getText()}' must be at least or at most one 'build' method.`,
      pos: parentComponentName.getStart()
    });
  }
}

function validateHasController(componentName: ts.Identifier, checkController: ControllerType,
  log: LogInfo[]): void {
  if (!checkController.hasController) {
    log.push({
      type: LogType.ERROR,
      message: '@CustomDialog component should have a property of the CustomDialogController type.',
      pos: componentName.pos
    });
  }
}
