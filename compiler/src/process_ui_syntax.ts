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
import path from 'path';

import { componentCollection } from './validate_ui_syntax';
import {
  processComponentClass,
  createParentParameter
} from './process_component_class';
import processImport from './process_import';
import {
  PAGE_ENTRY_FUNCTION_NAME,
  PREVIEW_COMPONENT_FUNCTION_NAME,
  STORE_PREVIEW_COMPONENTS,
  GET_PREVIEW_FLAG_FUNCTION_NAME,
  COMPONENT_CONSTRUCTOR_UNDEFINED,
  BUILD_ON,
  COMPONENT_BUILDER_DECORATOR,
  COMPONENT_EXTEND_DECORATOR,
  COMPONENT_STYLES_DECORATOR,
  RESOURCE,
  RESOURCE_TYPE,
  WORKER_OBJECT,
  RESOURCE_NAME_ID,
  RESOURCE_NAME_TYPE,
  RESOURCE_NAME_PARAMS,
  RESOURCE_RAWFILE,
  RESOURCE_NAME_BUNDLE,
  RESOURCE_NAME_MODULE,
  ATTRIBUTE_ANIMATETO,
  GLOBAL_CONTEXT,
  CHECK_COMPONENT_EXTEND_DECORATOR,
  INSTANCE,
  SET_CONTROLLER_CTR_TYPE,
  SET_CONTROLLER_METHOD,
  JS_DIALOG,
  CUSTOM_DIALOG_CONTROLLER_BUILDER,
  ESMODULE,
  ARK,
  COMPONENT_CONSTRUCTOR_PARENT,
  COMPONENT_IF_UNDEFINED,
  EXTNAME_ETS,
  GENERATE_ID,
  _GENERATE_ID
} from './pre_define';
import {
  componentInfo,
  LogInfo,
  LogType,
  hasDecorator,
  FileLog,
  writeFileSyncByNode
} from './utils';
import {
  processComponentBlock,
  bindComponentAttr,
  getName
} from './process_component_build';
import {
  BUILDIN_STYLE_NAMES,
  CUSTOM_BUILDER_METHOD,
  EXTEND_ATTRIBUTE,
  INNER_STYLE_FUNCTION,
  GLOBAL_STYLE_FUNCTION,
  INTERFACE_NODE_SET,
  ID_ATTRS
} from './component_map';
import {
  localStorageLinkCollection,
  localStoragePropCollection
} from './validate_ui_syntax';
import {
  resources,
  projectConfig
} from '../main';
import { createCustomComponentNewExpression, createViewCreate } from './process_component_member';

export const transformLog: FileLog = new FileLog();
export let contextGlobal: ts.TransformationContext;

export function processUISyntax(program: ts.Program, ut = false): Function {
  return (context: ts.TransformationContext) => {
    contextGlobal = context;
    let pagesDir: string;
    return (node: ts.SourceFile) => {
      pagesDir = path.resolve(path.dirname(node.fileName));
      if (process.env.compiler === BUILD_ON) {
        transformLog.sourceFile = node;
        preprocessIdAttrs(node.fileName);
        if (!ut && (path.basename(node.fileName) === 'app.ets' || /\.ts$/.test(node.fileName))) {
          node = ts.visitEachChild(node, processResourceNode, context);
          if (projectConfig.compileMode === ESMODULE && projectConfig.processTs === true
            && process.env.compilerType && process.env.compilerType === ARK) {
            writeFileSyncByNode(node, true);
          }
          return node;
        }
        node = createEntryNode(node, context);
        node = ts.visitEachChild(node, processAllNodes, context);
        GLOBAL_STYLE_FUNCTION.forEach((block, styleName) => {
          BUILDIN_STYLE_NAMES.delete(styleName);
        });
        GLOBAL_STYLE_FUNCTION.clear();
        const statements: ts.Statement[] = Array.from(node.statements);
        generateId(statements, node);
        INTERFACE_NODE_SET.forEach(item => {
          statements.unshift(item);
        });
        node = ts.factory.updateSourceFile(node, statements);
        INTERFACE_NODE_SET.clear();
        if (projectConfig.compileMode === ESMODULE && projectConfig.processTs === true
          && process.env.compilerType && process.env.compilerType === ARK) {
          writeFileSyncByNode(node, true);
        }
        return node;
      } else {
        return node;
      }
    };
    function processAllNodes(node: ts.Node): ts.Node {
      if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) ||
        ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        processImport(node, pagesDir, transformLog.errors);
      } else if (ts.isStructDeclaration(node)) {
        componentCollection.currentClassName = node.name.getText();
        node = processComponentClass(node, context, transformLog.errors, program);
        componentCollection.currentClassName = null;
        INNER_STYLE_FUNCTION.forEach((block, styleName) => {
          BUILDIN_STYLE_NAMES.delete(styleName);
        });
        INNER_STYLE_FUNCTION.clear();
      } else if (ts.isFunctionDeclaration(node)) {
        if (hasDecorator(node, COMPONENT_EXTEND_DECORATOR)) {
          node = processExtend(node, transformLog.errors);
        } else if (hasDecorator(node, COMPONENT_BUILDER_DECORATOR) && node.name && node.body &&
          ts.isBlock(node.body)) {
          CUSTOM_BUILDER_METHOD.add(node.name.getText());
          node.parameters.push(createParentParameter());
          node = ts.factory.updateFunctionDeclaration(node, undefined, node.modifiers,
            node.asteriskToken, node.name, node.typeParameters, node.parameters, node.type,
            processComponentBlock(node.body, false, transformLog.errors, false, true, node.name.getText()));
        } else if (hasDecorator(node, COMPONENT_STYLES_DECORATOR)) {
          if (node.parameters.length === 0) {
            node = undefined;
          } else {
            transformLog.errors.push({
              type: LogType.ERROR,
              message: `@Styles can't have parameters.`,
              pos: node.getStart()
            });
          }
        }
      } else if (isResource(node)) {
        node = processResourceData(node as ts.CallExpression);
      } else if (isWorker(node)) {
        node = processWorker(node as ts.NewExpression);
      } else if (isAnimateTo(node)) {
        node = processAnimateTo(node as ts.CallExpression);
      } else if (isCustomDialogController(node)) {
        node = createCustomDialogController(node.parent, node, transformLog.errors);
      }
      return ts.visitEachChild(node, processAllNodes, context);
    }
    function processResourceNode(node: ts.Node): ts.Node {
      if (isResource(node)) {
        node = processResourceData(node as ts.CallExpression);
      }
      return ts.visitEachChild(node, processResourceNode, context);
    }
  };
}

function generateId(statements: ts.Statement[], node: ts.SourceFile): void {
  statements.unshift(
    ts.factory.createVariableStatement(
      undefined,
      ts.factory.createVariableDeclarationList(
        [ts.factory.createVariableDeclaration(
          ts.factory.createIdentifier(_GENERATE_ID),
          undefined,
          ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
          ts.factory.createNumericLiteral("0")
        )],
        ts.NodeFlags.Let
      )
    ),
    ts.factory.createFunctionDeclaration(
      undefined,
      undefined,
      undefined,
      ts.factory.createIdentifier(GENERATE_ID),
      undefined,
      [],
      ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
      ts.factory.createBlock(
        [ts.factory.createReturnStatement(ts.factory.createBinaryExpression(
          ts.factory.createStringLiteral(path.basename(node.fileName, EXTNAME_ETS)+'_'),
          ts.factory.createToken(ts.SyntaxKind.PlusToken),ts.factory.createPrefixUnaryExpression(
          ts.SyntaxKind.PlusPlusToken,
          ts.factory.createIdentifier(_GENERATE_ID)
        )))],
        true
      )
    )
  )
}

function preprocessIdAttrs(fileName: string): void {
  for (const [id, idInfo] of ID_ATTRS) {
    if (fileName === idInfo.get('path')) {
      ID_ATTRS.delete(id);
    }
  }
}

function isCustomDialogController(node: ts.Expression) {
  const tempParent: ts.Node = node.parent;
  // @ts-ignore
  if (!node.parent && node.original) {
    // @ts-ignore
    node.parent = node.original.parent;
  }
  if (ts.isNewExpression(node) && node.expression && ts.isIdentifier(node.expression) &&
    node.expression.escapedText.toString() === SET_CONTROLLER_CTR_TYPE) {
    return true;
  } else {
    // @ts-ignore
    node.parent = tempParent;
    return false;
  }
}

function createCustomDialogController(parent: ts.Expression, node: ts.NewExpression,
  log: LogInfo[]): ts.NewExpression {
  if (node.arguments && node.arguments.length === 1 &&
    ts.isObjectLiteralExpression(node.arguments[0]) && node.arguments[0].properties) {
    const newproperties: ts.ObjectLiteralElementLike[] = node.arguments[0].properties.map((item) => {
      const componentName: string = isCustomDialogControllerPropertyAssignment(item, log);
      if (componentName !== null) {
        item = processCustomDialogControllerPropertyAssignment(parent,
          item as ts.PropertyAssignment, componentName);
      }
      return item;
    });
    return ts.factory.createNewExpression(node.expression, node.typeArguments,
      [ts.factory.createObjectLiteralExpression(newproperties, true), ts.factory.createThis()]);
  }
}

function isCustomDialogControllerPropertyAssignment(node: ts.ObjectLiteralElementLike,
  log: LogInfo[]): string {
  if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) &&
    node.name.getText() === CUSTOM_DIALOG_CONTROLLER_BUILDER) {
    if (node.initializer) {
      const componentName: string = getName(node.initializer);
      if (componentCollection.customDialogs.has(componentName)) {
        return componentName;
      }
    } else {
      validateCustomDialogControllerBuilderInit(node, log);
    }
  }
  return null;
}

function validateCustomDialogControllerBuilderInit(node: ts.ObjectLiteralElementLike,
  log: LogInfo[]): void {
  log.push({
    type: LogType.ERROR,
    message: 'The builder should be initialized with a @CustomDialog Component.',
    pos: node.getStart()
  });
}

function processCustomDialogControllerPropertyAssignment(parent: ts.Expression,
  node: ts.PropertyAssignment, componentName: string): ts.PropertyAssignment {
  if (ts.isCallExpression(node.initializer)) {
    return ts.factory.updatePropertyAssignment(node, node.name,
      processCustomDialogControllerBuilder(parent, node.initializer, componentName));
  }
}

function processCustomDialogControllerBuilder(parent: ts.Expression,
  node: ts.CallExpression, componentName: string): ts.ArrowFunction {
  const newExp: ts.Expression = createCustomComponentNewExpression(node, componentName);
  const jsDialog: ts.Identifier = ts.factory.createIdentifier(JS_DIALOG);
  return createCustomComponentBuilderArrowFunction(parent, jsDialog, newExp);
}

function createCustomComponentBuilderArrowFunction(parent: ts.Expression,
  jsDialog: ts.Identifier, newExp: ts.Expression): ts.ArrowFunction {
  let mountNodde: ts.PropertyAccessExpression;
  if (ts.isBinaryExpression(parent)) {
    mountNodde = parent.left;
  } else if (ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent)) {
    mountNodde = ts.factory.createPropertyAccessExpression(ts.factory.createThis(),
      parent.name as ts.Identifier);
  }
  return ts.factory.createArrowFunction(
    undefined,
    undefined,
    [],
    undefined,
    ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    ts.factory.createBlock(
      [
        ts.factory.createVariableStatement(
          undefined,
          ts.factory.createVariableDeclarationList(
            [ts.factory.createVariableDeclaration(jsDialog, undefined, undefined, newExp)],
            ts.NodeFlags.Let
          )
        ),
        ts.factory.createExpressionStatement(
          ts.factory.createCallExpression(
            ts.factory.createPropertyAccessExpression(
              jsDialog,
              ts.factory.createIdentifier(SET_CONTROLLER_METHOD)
            ),
            undefined,
            [mountNodde]
          )
        ),
        ts.factory.createExpressionStatement(createViewCreate(jsDialog))
      ],
      true
    )
  );
}

function isResource(node: ts.Node): boolean {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
    (node.expression.escapedText.toString() === RESOURCE ||
    node.expression.escapedText.toString() === RESOURCE_RAWFILE) && node.arguments.length > 0;
}

function isAnimateTo(node: ts.Node): boolean {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
    node.expression.escapedText.toString() === ATTRIBUTE_ANIMATETO;
}

function processResourceData(node: ts.CallExpression): ts.Node {
  if (ts.isStringLiteral(node.arguments[0])) {
    if (node.expression.getText() === RESOURCE_RAWFILE) {
      return createResourceParam(0, RESOURCE_TYPE.rawfile, [node.arguments[0]]);
    } else {
      return getResourceDataNode(node);
    }
  }
  return node;
}

function getResourceDataNode(node: ts.CallExpression): ts.Node {
  const resourceData: string[] = (node.arguments[0] as ts.StringLiteral).text.trim().split('.');
  if (validateResourceData(resourceData, resources, node.arguments[0].getStart())) {
    const resourceType: number = RESOURCE_TYPE[resourceData[1]];
    if (resourceType === undefined) {
      transformLog.errors.push({
        type: LogType.ERROR,
        message: `The resource type ${resourceData[1]} is not supported.`,
        pos: node.getStart()
      });
      return node;
    }
    const resourceValue: number = resources[resourceData[0]][resourceData[1]][resourceData[2]];
    return createResourceParam(resourceValue, resourceType,
      Array.from(node.arguments).slice(1));
  }
  return node;
}

function createResourceParam(resourceValue: number, resourceType: number, argsArr: ts.Expression[]):
  ts.ObjectLiteralExpression {
  const propertyArray: Array[ts.PropertyAssignment] = [
    ts.factory.createPropertyAssignment(
      ts.factory.createStringLiteral(RESOURCE_NAME_ID),
      ts.factory.createNumericLiteral(resourceValue)
    ),
    ts.factory.createPropertyAssignment(
      ts.factory.createStringLiteral(RESOURCE_NAME_TYPE),
      ts.factory.createNumericLiteral(resourceType)
    ),
    ts.factory.createPropertyAssignment(
      ts.factory.createIdentifier(RESOURCE_NAME_PARAMS),
      ts.factory.createArrayLiteralExpression(argsArr, false)
    )
  ];

  if (projectConfig.bundleName) {
    propertyArray.push(ts.factory.createPropertyAssignment(
      ts.factory.createStringLiteral(RESOURCE_NAME_BUNDLE),
      ts.factory.createStringLiteral(projectConfig.bundleName)
    ));
  }

  if (projectConfig.moduleName) {
    propertyArray.push(ts.factory.createPropertyAssignment(
      ts.factory.createStringLiteral(RESOURCE_NAME_MODULE),
      ts.factory.createStringLiteral(projectConfig.moduleName)
    ));
  }

  const resourceParams: ts.ObjectLiteralExpression = ts.factory.createObjectLiteralExpression(
    propertyArray, false);
  return resourceParams;
}

function validateResourceData(resourceData: string[], resources: object, pos: number): boolean {
  if (resourceData.length !== 3) {
    transformLog.errors.push({
      type: LogType.ERROR,
      message: 'The input parameter is not supported.',
      pos: pos
    });
  } else if (!resources[resourceData[0]]) {
    transformLog.errors.push({
      type: LogType.ERROR,
      message: `The value of '${resourceData[0]}' is invalid.`,
      pos: pos
    });
  } else if (!resources[resourceData[0]][resourceData[1]]) {
    transformLog.errors.push({
      type: LogType.ERROR,
      message: `Value '${resourceData[1]}' does not exist on type 'typeof ${resourceData[0]}'.`,
      pos: pos
    });
  } else if (!resources[resourceData[0]][resourceData[1]][resourceData[2]]) {
    transformLog.errors.push({
      type: LogType.ERROR,
      message: `Value '${resourceData[2]}' does not exist on type 'typeof ${resourceData[1]}'.`,
      pos: pos
    });
  } else {
    return true;
  }
  return false;
}

function isWorker(node: ts.Node): boolean {
  return ts.isNewExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.name) &&
    node.expression.name.escapedText.toString() === WORKER_OBJECT;
}

function processWorker(node: ts.NewExpression): ts.Node {
  if (node.arguments.length && ts.isStringLiteral(node.arguments[0])) {
    const args: ts.Expression[] = Array.from(node.arguments);
    // @ts-ignore
    const workerPath: string = node.arguments[0].text;
    const stringNode: ts.StringLiteral = ts.factory.createStringLiteral(
      workerPath.replace(/\.ts$/, '.js'));
    args.splice(0, 1, stringNode);
    return ts.factory.updateNewExpression(node, node.expression, node.typeArguments, args);
  }
  return node;
}

function processAnimateTo(node: ts.CallExpression): ts.CallExpression {
  return ts.factory.updateCallExpression(node, ts.factory.createPropertyAccessExpression(
    ts.factory.createIdentifier(GLOBAL_CONTEXT), ts.factory.createIdentifier(ATTRIBUTE_ANIMATETO)),
  node.typeArguments, node.arguments);
}

function processExtend(node: ts.FunctionDeclaration, log: LogInfo[]): ts.FunctionDeclaration {
  const componentName: string = isExtendFunction(node);
  if (componentName && node.body && node.body.statements.length) {
    const statementArray: ts.Statement[] = [];
    let bodynode: ts.Block;
    const attrSet: ts.CallExpression = node.body.statements[0].expression;
    if (isOriginalExtend(node.body)) {
      const changeCompName: ts.ExpressionStatement = ts.factory.createExpressionStatement(processExtendBody(attrSet));
      bindComponentAttr(changeCompName as ts.ExpressionStatement,
        ts.factory.createIdentifier(componentName), statementArray, log);
    } else {
      bodynode = ts.visitEachChild(node.body, traverseExtendExpression, contextGlobal);
    }
    let extendFunctionName: string;
    if (node.name.getText().startsWith('__' + componentName + '__')) {
      extendFunctionName = node.name.getText();
    } else {
      extendFunctionName = '__' + componentName + '__' + node.name.getText();
      collectExtend(EXTEND_ATTRIBUTE, componentName, node.name.escapedText.toString());
    }
    return ts.factory.updateFunctionDeclaration(node, undefined, node.modifiers, node.asteriskToken,
      ts.factory.createIdentifier(extendFunctionName), node.typeParameters,
      node.parameters, node.type, isOriginalExtend(node.body) ?
        ts.factory.updateBlock(node.body, statementArray) : bodynode);
  }
  function traverseExtendExpression(node: ts.Node): ts.Node {
    if (ts.isExpressionStatement(node) && isDollarNode(node)) {
      const changeCompName: ts.ExpressionStatement =
        ts.factory.createExpressionStatement(processExtendBody(node.expression, componentName));
      const statementArray: ts.Statement[] = [];
      bindComponentAttr(changeCompName, ts.factory.createIdentifier(componentName), statementArray, []);
      return ts.factory.createCallExpression(
        ts.factory.createParenthesizedExpression(ts.factory.createFunctionExpression(
          undefined, undefined, undefined, undefined, [], undefined,
          ts.factory.createBlock(statementArray, true))), undefined, []);
    }
    return ts.visitEachChild(node, traverseExtendExpression, contextGlobal);
  }
}

export function isOriginalExtend(node: ts.Block): boolean {
  let innerNode: ts.Node = node.statements[0];
  if (node.statements.length === 1 && ts.isExpressionStatement(innerNode)) {
    while (innerNode.expression) {
      innerNode = innerNode.expression;
    }
    if (ts.isIdentifier(innerNode) && innerNode.pos && innerNode.end && innerNode.pos === innerNode.end &&
      innerNode.escapedText.toString().match(/Instance$/)) {
      return true;
    }
  }
  return false;
}

function isDollarNode(node: ts.ExpressionStatement): boolean {
  let innerNode: ts.Node = node;
  while (innerNode.expression) {
    innerNode = innerNode.expression;
  }
  if (ts.isIdentifier(innerNode) && innerNode.getText() === '$') {
    return true;
  } else {
    return false;
  }
}

function processExtendBody(node: ts.Node, componentName?: string): ts.Expression {
  switch (node.kind) {
    case ts.SyntaxKind.CallExpression:
      return ts.factory.createCallExpression(processExtendBody(node.expression, componentName),
        undefined, node.arguments);
    case ts.SyntaxKind.PropertyAccessExpression:
      return ts.factory.createPropertyAccessExpression(
        processExtendBody(node.expression, componentName), node.name);
    case ts.SyntaxKind.Identifier:
      if (!componentName) {
        return ts.factory.createIdentifier(node.escapedText.toString().replace(INSTANCE, ''));
      } else {
        return ts.factory.createIdentifier(componentName);
      }
  }
}

export function collectExtend(collectionSet: Map<string, Set<string>>, component: string, attribute: string): void {
  if (collectionSet.has(component)) {
    collectionSet.get(component).add(attribute);
  } else {
    collectionSet.set(component, new Set([attribute]));
  }
}

export function isExtendFunction(node: ts.FunctionDeclaration): string {
  if (node.decorators && node.decorators.length) {
    for (let i = 0, len = node.decorators.length; i < len; i++) {
      if (node.decorators[i].expression && node.decorators[i].expression.expression &&
        node.decorators[i].expression.expression.escapedText.toString() === CHECK_COMPONENT_EXTEND_DECORATOR &&
        node.decorators[i].expression.arguments) {
        return node.decorators[i].expression.arguments[0].escapedText.toString();
      }
    }
  }
  return null;
}

function createEntryNode(node: ts.SourceFile, context: ts.TransformationContext): ts.SourceFile {
  if (componentCollection.previewComponent.size === 0 || !projectConfig.isPreview) {
    if (componentCollection.entryComponent) {
      const entryNode: ts.ExpressionStatement =
        createEntryFunction(componentCollection.entryComponent, context);
      return context.factory.updateSourceFile(node, [...node.statements, entryNode]);
    } else {
      return node;
    }
  } else {
    const statementsArray: ts.Statement =
      createPreviewComponentFunction(componentCollection.entryComponent, context);
    return context.factory.updateSourceFile(node, [...node.statements, statementsArray]);
  }
}

function createEntryFunction(name: string, context: ts.TransformationContext)
  : ts.ExpressionStatement {
  let localStorageName: string;
  const localStorageNum: number = localStorageLinkCollection.get(name).size +
    localStoragePropCollection.get(name).size;
  if (componentCollection.entryComponent === name && componentCollection.localStorageName &&
    localStorageNum) {
    localStorageName = componentCollection.localStorageName;
  } else if (componentCollection.entryComponent === name && !componentCollection.localStorageName
    && localStorageNum) {
    transformLog.errors.push({
      type: LogType.ERROR,
      message: `@Entry should have a parameter, like '@Entry (storage)'.`,
      pos: componentCollection.entryComponentPos
    });
    return;
  }
  const newArray: ts.Expression[] = [
    context.factory.createStringLiteral((++componentInfo.id).toString()),
    context.factory.createIdentifier(COMPONENT_CONSTRUCTOR_UNDEFINED),
    context.factory.createObjectLiteralExpression([], false)
  ];
  if (localStorageName) {
    newArray.push(context.factory.createIdentifier(localStorageName));
  }
  const newExpressionStatement: ts.ExpressionStatement =
    context.factory.createExpressionStatement(context.factory.createCallExpression(
      context.factory.createIdentifier(PAGE_ENTRY_FUNCTION_NAME), undefined,
      [context.factory.createNewExpression(context.factory.createIdentifier(name),
        undefined, newArray)]));
  return newExpressionStatement;
}

function createPreviewComponentFunction(name: string, context: ts.TransformationContext)
  : ts.Statement {
  const newArray: ts.Expression[] = [
    context.factory.createStringLiteral((++componentInfo.id).toString()),
    context.factory.createIdentifier(COMPONENT_CONSTRUCTOR_UNDEFINED),
    context.factory.createObjectLiteralExpression([], false)
  ];
  const argsArr: ts.Expression[] = [];
  componentCollection.previewComponent.forEach(componentName => {
    const newExpression: ts.Expression = context.factory.createNewExpression(
      context.factory.createIdentifier(componentName),
      undefined,
      newArray
    );
    argsArr.push(context.factory.createStringLiteral(componentName));
    argsArr.push(newExpression);
  });
  const ifStatement: ts.Statement = context.factory.createIfStatement(
    context.factory.createCallExpression(
      context.factory.createIdentifier(GET_PREVIEW_FLAG_FUNCTION_NAME),
      undefined,
      []
    ),
    context.factory.createBlock(
      [context.factory.createExpressionStatement(context.factory.createCallExpression(
        context.factory.createIdentifier(PREVIEW_COMPONENT_FUNCTION_NAME),
        undefined,
        []
      ))],
      true
    ),
    context.factory.createBlock(
      [
        context.factory.createExpressionStatement(context.factory.createCallExpression(
          context.factory.createIdentifier(STORE_PREVIEW_COMPONENTS),
          undefined,
          [
            context.factory.createNumericLiteral(componentCollection.previewComponent.size),
            ...argsArr
          ]
        )),
        name ? context.factory.createExpressionStatement(context.factory.createCallExpression(
          context.factory.createIdentifier(PAGE_ENTRY_FUNCTION_NAME),
          undefined,
          [context.factory.createNewExpression(
            context.factory.createIdentifier(name),
            undefined,
            newArray
          )]
        )) : undefined
      ],
      true
    )
  );
  return ifStatement;
}

export function resetLog(): void {
  transformLog.errors = [];
}
