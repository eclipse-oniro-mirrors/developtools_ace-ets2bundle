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

import {
  COMPONENT_RENDER_FUNCTION,
  COMPONENT_CREATE_FUNCTION,
  COMPONENT_POP_FUNCTION,
  COMPONENT_BUTTON,
  COMPONENT_CREATE_LABEL_FUNCTION,
  COMPONENT_CREATE_CHILD_FUNCTION,
  COMPONENT_FOREACH,
  COMPONENT_LAZYFOREACH,
  IS_RENDERING_IN_PROGRESS,
  FOREACH_OBSERVED_OBJECT,
  FOREACH_GET_RAW_OBJECT,
  COMPONENT_IF,
  COMPONENT_IF_BRANCH_ID_FUNCTION,
  COMPONENT_IF_UNDEFINED,
  ATTRIBUTE_ANIMATION,
  GLOBAL_CONTEXT,
  COMPONENT_GESTURE,
  COMPONENT_GESTURE_GROUP,
  GESTURE_ATTRIBUTE,
  PARALLEL_GESTURE_ATTRIBUTE,
  PRIORITY_GESTURE_ATTRIBUTE,
  GESTURE_ENUM_KEY,
  GESTURE_ENUM_VALUE_HIGH,
  GESTURE_ENUM_VALUE_LOW,
  GESTURE_ENUM_VALUE_PARALLEL,
  COMPONENT_TRANSITION_NAME,
  COMPONENT_DEBUGLINE_FUNCTION,
  ATTRIBUTE_STATESTYLES,
  THIS,
  VISUAL_STATE,
  VIEW_STACK_PROCESSOR,
  STYLE_ADD_DOUBLE_DOLLAR,
  $$_VALUE,
  $$_CHANGE_EVENT,
  $$_THIS,
  $$_NEW_VALUE,
  BUILDER_ATTR_NAME,
  BUILDER_ATTR_BIND,
  CUSTOM_DIALOG_CONTROLLER_BUILDER,
  BIND_DRAG_SET,
  BIND_POPUP_SET,
  $$,
  PROPERTIES_ADD_DOUBLE_DOLLAR,
  ATTRIBUTE_ID
} from './pre_define';
import {
  INNER_COMPONENT_NAMES,
  BUILDIN_CONTAINER_COMPONENT,
  BUILDIN_STYLE_NAMES,
  CUSTOM_BUILDER_METHOD,
  GESTURE_ATTRS,
  GESTURE_TYPE_NAMES,
  EXTEND_ATTRIBUTE,
  NO_DEBUG_LINE_COMPONENT,
  NEEDPOP_COMPONENT,
  INNER_STYLE_FUNCTION,
  GLOBAL_STYLE_FUNCTION,
  COMMON_ATTRS,
  CUSTOM_BUILDER_PROPERTIES,
  INNER_CUSTOM_BUILDER_METHOD,
  ID_ATTRS
} from './component_map';
import {
  componentCollection,
  builderParamObjectCollection,
  checkAllNode
} from './validate_ui_syntax';
import { processCustomComponent } from './process_custom_component';
import {
  LogType,
  LogInfo,
  componentInfo,
  createFunction
} from './utils';
import { projectConfig } from '../main';
import { transformLog, contextGlobal } from './process_ui_syntax';
import { props } from './compile_info';
import { CUSTOM_COMPONENT } from './pre_define';


export function processComponentBuild(node: ts.MethodDeclaration,
  log: LogInfo[]): ts.MethodDeclaration {
  let newNode: ts.MethodDeclaration;
  const renderNode: ts.Identifier = ts.factory.createIdentifier(COMPONENT_RENDER_FUNCTION);
  if (node.body && node.body.statements && node.body.statements.length &&
    validateRootNode(node, log)) {
    newNode = ts.factory.updateMethodDeclaration(node, node.decorators, node.modifiers,
      node.asteriskToken, renderNode, node.questionToken, node.typeParameters, node.parameters,
      node.type, processComponentBlock(node.body, false, log));
  } else {
    newNode = ts.factory.updateMethodDeclaration(node, node.decorators, node.modifiers,
      node.asteriskToken, renderNode, node.questionToken, node.typeParameters, node.parameters,
      node.type, node.body);
  }
  return newNode;
}

export function processComponentBlock(node: ts.Block, isLazy: boolean, log: LogInfo[],
  isTransition: boolean = false, isInnerBuilder: boolean = false, parent: string = undefined): ts.Block {
  const newStatements: ts.Statement[] = [];
  processComponentChild(node, newStatements, log,
    {isAcceleratePreview: false, line: 0, column: 0, fileName: ''}, isInnerBuilder, parent);
  if (isLazy) {
    newStatements.unshift(createRenderingInProgress(true));
  }
  if (isTransition) {
    newStatements.unshift(ts.factory.createExpressionStatement(
      createFunction(ts.factory.createIdentifier(COMPONENT_TRANSITION_NAME),
        ts.factory.createIdentifier(COMPONENT_CREATE_FUNCTION), null)));
    newStatements.push(ts.factory.createExpressionStatement(
      createFunction(ts.factory.createIdentifier(COMPONENT_TRANSITION_NAME),
        ts.factory.createIdentifier(COMPONENT_POP_FUNCTION), null)));
  }
  if (isLazy) {
    newStatements.push(createRenderingInProgress(false));
  }
  return ts.factory.updateBlock(node, newStatements);
}

function validateRootNode(node: ts.MethodDeclaration, log: LogInfo[]): boolean {
  let isValid: boolean = false;
  if (node.body.statements.length === 1) {
    const statement: ts.Statement = node.body.statements[0];
    if (ts.isIfStatement(statement) || validateFirstNode(statement)) {
      isValid = true;
    }
  } else {
    isValid = false;
  }
  if (!isValid) {
    log.push({
      type: LogType.ERROR,
      message: `There should have a root container component.`,
      pos: node.body.statements.pos
    });
  }
  return isValid;
}

function validateFirstNode(node: ts.Statement): boolean {
  const isEntryComponent: boolean =
    componentCollection.entryComponent === componentCollection.currentClassName;
  if (isEntryComponent && !validateContainerComponent(node)) {
    return false;
  }
  return true;
}

function validateContainerComponent(node: ts.Statement): boolean {
  if (ts.isExpressionStatement(node) && node.expression &&
    (ts.isEtsComponentExpression(node.expression) || ts.isCallExpression(node.expression))) {
    const nameResult: NameResult = { name: null };
    validateEtsComponentNode(node.expression, nameResult);
    if (nameResult.name && BUILDIN_CONTAINER_COMPONENT.has(nameResult.name)) {
      return true;
    }
  }
  return false;
}

interface supplementType {
  isAcceleratePreview: boolean,
  line: number,
  column: number,
  fileName: string
}

let newsupplement: supplementType = {
  isAcceleratePreview: false,
  line: 0,
  column: 0,
  fileName: ''
};

type NameResult = {
  name: string
}

function validateEtsComponentNode(node: ts.CallExpression | ts.EtsComponentExpression, result?: NameResult) {
  let childNode: ts.Node = node;
  result.name = null;
  while (ts.isCallExpression(childNode) && childNode.expression &&
    ts.isPropertyAccessExpression(childNode.expression) && childNode.expression.expression) {
    childNode = childNode.expression.expression;
  }
  if (ts.isEtsComponentExpression(childNode)) {
    if (ts.isIdentifier(childNode.expression)) {
      result.name = childNode.expression.getText();
    }
    return true;
  } else {
    return false;
  }
}

let sourceNode: ts.SourceFile;

export function processComponentChild(node: ts.Block | ts.SourceFile, newStatements: ts.Statement[],
  log: LogInfo[], supplement: supplementType = {isAcceleratePreview: false, line: 0, column: 0, fileName: ''},
  isInnerBuilder: boolean = false, parent: string = undefined): void {
  if (supplement.isAcceleratePreview) {
    newsupplement = supplement;
    const compilerOptions = ts.readConfigFile(
      path.resolve(__dirname, '../tsconfig.json'), ts.sys.readFile).config.compilerOptions;
    Object.assign(compilerOptions, {
      'sourceMap': false
    });
    sourceNode = ts.createSourceFile('', node.getText(), ts.ScriptTarget.Latest, true, ts.ScriptKind.ETS, compilerOptions);
  }
  if (node.statements.length) {
    node.statements.forEach((item) => {
      if (ts.isExpressionStatement(item)) {
        checkEtsComponent(item, log);
        const name: string = getName(item);
        switch (getComponentType(item, log, name, parent)) {
          case ComponentType.innerComponent:
            parent = name;
            processInnerComponent(item, newStatements, log, parent);
            break;
          case ComponentType.customComponent:
            parent = undefined;
            if (!newsupplement.isAcceleratePreview) {
              if (item.expression && ts.isEtsComponentExpression(item.expression) && item.expression.body) {
                const expressionResult: ts.ExpressionStatement =
                  processExpressionStatementChange(item, item.expression.body, log);
                if (expressionResult) {
                  item = expressionResult;
                }
              }
              processCustomComponent(item as ts.ExpressionStatement, newStatements, log, name, isInnerBuilder);
            }
            break;
          case ComponentType.forEachComponent:
            parent = undefined;
            processForEachComponent(item, newStatements, log, isInnerBuilder);
            break;
          case ComponentType.customBuilderMethod:
            parent = undefined;
            if (CUSTOM_BUILDER_METHOD.has(name)) {
              newStatements.push(addInnerBuilderParameter(item));
            } else {
              newStatements.push(item);
            }
            break;
          case ComponentType.builderParamMethod:
            parent = undefined;
            newStatements.push(addInnerBuilderParameter(item));
            break;
          case ComponentType.function:
            parent = undefined;
            newStatements.push(item);
            break;
        }
      } else if (ts.isIfStatement(item)) {
        processIfStatement(item, newStatements, log, isInnerBuilder);
      } else if (!ts.isBlock(item)) {
        log.push({
          type: LogType.ERROR,
          message: `Only UI component syntax can be written in build method.`,
          pos: item.getStart()
        });
      }
    });
  }
  newsupplement = {
    isAcceleratePreview: false,
    line: 0,
    column: 0,
    fileName: ''
  };
}

function addInnerBuilderParameter(node: ts.ExpressionStatement): ts.ExpressionStatement {
  if (node.expression && ts.isCallExpression(node.expression) && node.expression.arguments) {
    node.expression.arguments.push(ts.factory.createThis());
    return ts.factory.createExpressionStatement(ts.factory.updateCallExpression(node.expression,
      node.expression.expression, node.expression.typeArguments, node.expression.arguments));
  } else {
    return node;
  }
}

function processExpressionStatementChange(node: ts.ExpressionStatement, nextNode: ts.Block,
  log: LogInfo[]): ts.ExpressionStatement {
  let name: string;
  // @ts-ignore
  if (node.expression.expression && ts.isIdentifier(node.expression.expression)) {
    name = node.expression.expression.escapedText.toString();
  }
  if (builderParamObjectCollection.get(name) &&
    builderParamObjectCollection.get(name).size === 1) {
    return processBlockToExpression(node, nextNode, log, name);
  } else {
    log.push({
      type: LogType.ERROR,
      message: `In the trailing lambda case, '${name}' must have one and only one property decorated with `
        + `@BuilderParam, and its @BuilderParam expects no parameter.`,
      pos: node.getStart()
    });
    return null;
  }
}

function processBlockToExpression(node: ts.ExpressionStatement, nextNode: ts.Block,
  log: LogInfo[], name: string): ts.ExpressionStatement {
  const childParam: string = [...builderParamObjectCollection.get(name)].slice(-1)[0];
  const newBlock: ts.Block = processComponentBlock(nextNode, false, log);
  const arrowNode: ts.ArrowFunction = ts.factory.createArrowFunction(undefined, undefined,
    [], undefined, ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken), newBlock);
  const newPropertyAssignment:ts.PropertyAssignment = ts.factory.createPropertyAssignment(
    ts.factory.createIdentifier(childParam), arrowNode);
  // @ts-ignore
  let argumentsArray: ts.ObjectLiteralExpression[] = node.expression.arguments;
  if (argumentsArray && !argumentsArray.length) {
    argumentsArray = [ts.factory.createObjectLiteralExpression([newPropertyAssignment], true)];
  } else {
    argumentsArray = [ts.factory.createObjectLiteralExpression(
      // @ts-ignore
      node.expression.arguments[0].properties.concat([newPropertyAssignment]), true)];
  }
  const callNode: ts.CallExpression = ts.factory.updateCallExpression(
    // @ts-ignore
    node.expression, node.expression.expression, node.expression.expression.typeArguments,
    argumentsArray);
  // @ts-ignore
  node.expression.expression.parent = callNode;
  // @ts-ignore
  callNode.parent = node.expression.parent;
  node = ts.factory.updateExpressionStatement(node, callNode);
  return node;
}

type EtsComponentResult = {
  etsComponentNode: ts.EtsComponentExpression;
  hasAttr: boolean;
}
function parseEtsComponentExpression(node: ts.ExpressionStatement): EtsComponentResult {
  let etsComponentNode: ts.EtsComponentExpression;
  let hasAttr: boolean = false;
  let temp: any = node.expression;
  while (temp) {
    if (ts.isCallExpression(temp) && temp.expression &&
      ts.isPropertyAccessExpression(temp.expression)) {
      hasAttr = true;
    }
    if (ts.isEtsComponentExpression(temp)) {
      etsComponentNode = temp;
      break;
    }
    temp = temp.expression;
  }
  return { etsComponentNode: etsComponentNode, hasAttr: hasAttr };
}

function processInnerComponent(node: ts.ExpressionStatement, newStatements: ts.Statement[],
  log: LogInfo[], parent: string = undefined): void {
  const res: CreateResult = createComponent(node, COMPONENT_CREATE_FUNCTION);
  newStatements.push(res.newNode);
  const nameResult: NameResult = { name: null };
  validateEtsComponentNode(node.expression as ts.EtsComponentExpression, nameResult);
  if (projectConfig.isPreview && nameResult.name && !NO_DEBUG_LINE_COMPONENT.has(nameResult.name)) {
    let posOfNode: ts.LineAndCharacter;
    let curFileName: string;
    let line: number = 1;
    let col: number = 1;
    if (newsupplement.isAcceleratePreview) {
      posOfNode = sourceNode.getLineAndCharacterOfPosition(getRealNodePos(node));
      curFileName = newsupplement.fileName;
      if (posOfNode.line === 0) {
        col = newsupplement.column - 15;
      }
      line = newsupplement.line;
    } else {
      posOfNode = transformLog.sourceFile.getLineAndCharacterOfPosition(getRealNodePos(node));
      curFileName = transformLog.sourceFile.fileName.replace(/\.ts$/, '');
    }
    const projectPath: string = projectConfig.projectPath;
    const debugInfo: string =
      `${path.relative(projectPath, curFileName).replace(/\\+/g, '/')}` +
      `(${posOfNode.line + line}:${posOfNode.character + col})`;
    const debugNode: ts.ExpressionStatement = ts.factory.createExpressionStatement(
      createFunction(ts.factory.createIdentifier(nameResult.name),
        ts.factory.createIdentifier(COMPONENT_DEBUGLINE_FUNCTION),
        ts.factory.createNodeArray([ts.factory.createStringLiteral(debugInfo)])));
    newStatements.push(debugNode);
  }
  const etsComponentResult: EtsComponentResult = parseEtsComponentExpression(node);
  if (PROPERTIES_ADD_DOUBLE_DOLLAR.has(res.identifierNode.getText()) &&
    etsComponentResult.etsComponentNode.arguments && etsComponentResult.etsComponentNode.arguments.length) {
    etsComponentResult.etsComponentNode = processDollarEtsComponent(etsComponentResult.etsComponentNode,
      res.identifierNode.getText());
  }
  if (etsComponentResult.etsComponentNode.body && ts.isBlock(etsComponentResult.etsComponentNode.body)) {
    if (res.isButton) {
      if (projectConfig.isPreview) {
        newStatements.splice(-2, 1, createComponent(node, COMPONENT_CREATE_CHILD_FUNCTION).newNode);
      } else {
        newStatements.splice(-1, 1, createComponent(node, COMPONENT_CREATE_CHILD_FUNCTION).newNode);
      }
    }
    if (etsComponentResult.hasAttr) {
      bindComponentAttr(node, res.identifierNode, newStatements, log);
    }
    processComponentChild(etsComponentResult.etsComponentNode.body, newStatements, log,
      {isAcceleratePreview: false, line: 0, column: 0, fileName: ''}, false, parent);
  } else {
    bindComponentAttr(node, res.identifierNode, newStatements, log);
  }
  if (res.isContainerComponent || res.needPop) {
    newStatements.push(createComponent(node, COMPONENT_POP_FUNCTION).newNode);
  }
}

function getRealNodePos(node: ts.Node): number {
  // @ts-ignore
  if (node.pos === -1 && node.expression) {
    // @ts-ignore
    return getRealNodePos(node.expression);
  } else {
    return node.getStart();
  }
}

function processForEachComponent(node: ts.ExpressionStatement, newStatements: ts.Statement[],
  log: LogInfo[], isInnerBuilder: boolean = false): void {
  const popNode: ts.ExpressionStatement = ts.factory.createExpressionStatement(createFunction(
    // @ts-ignore
    node.expression.expression as ts.Identifier,
    ts.factory.createIdentifier(COMPONENT_POP_FUNCTION), null));
  if (ts.isCallExpression(node.expression)) {
    const propertyNode: ts.PropertyAccessExpression = ts.factory.createPropertyAccessExpression(
      node.expression.expression as ts.Identifier,
      ts.factory.createIdentifier(COMPONENT_CREATE_FUNCTION)
    );
    const argumentsArray: ts.Expression[] = Array.from(node.expression.arguments);
    let arrayObserveredObject: ts.CallExpression;
    if (argumentsArray.length) {
      arrayObserveredObject = ts.factory.createCallExpression(
        ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(FOREACH_OBSERVED_OBJECT),
          ts.factory.createIdentifier(FOREACH_GET_RAW_OBJECT)), undefined, [argumentsArray[0]]);
    }
    argumentsArray.splice(0, 1, arrayObserveredObject);
    const newArrowNode: ts.ArrowFunction = processForEachBlock(node.expression, log, isInnerBuilder);
    if (newArrowNode) {
      argumentsArray.splice(1, 1, newArrowNode);
    }
    node = addForEachId(ts.factory.updateExpressionStatement(node, ts.factory.updateCallExpression(
      node.expression, propertyNode, node.expression.typeArguments, argumentsArray)));
  }
  newStatements.push(node, popNode);
}

function addForEachId(node: ts.ExpressionStatement): ts.ExpressionStatement {
  const forEachComponent: ts.CallExpression = node.expression as ts.CallExpression;
  return ts.factory.updateExpressionStatement(node, ts.factory.updateCallExpression(
    forEachComponent, forEachComponent.expression, forEachComponent.typeArguments,
    [ts.factory.createStringLiteral((++componentInfo.id).toString()), ts.factory.createThis(),
      ...forEachComponent.arguments]));
}

function processForEachBlock(node: ts.CallExpression, log: LogInfo[],
  isInnerBuilder: boolean = false): ts.ArrowFunction {
  if (node.arguments.length > 1 && ts.isArrowFunction(node.arguments[1])) {
    const isLazy: boolean = node.expression.getText() === COMPONENT_LAZYFOREACH;
    const arrowNode: ts.ArrowFunction = node.arguments[1] as ts.ArrowFunction;
    const body: ts.ConciseBody = arrowNode.body;
    if (node.arguments.length > 2 && !ts.isArrowFunction(node.arguments[2])) {
      log.push({
        type: LogType.ERROR,
        message: 'There should be wrapped in curly braces in ForEach.',
        pos: body.getStart()
      });
    } else if (!ts.isBlock(body)) {
      const statement: ts.Statement = ts.factory.createExpressionStatement(body);
      const blockNode: ts.Block = ts.factory.createBlock([statement], true);
      // @ts-ignore
      statement.parent = blockNode;
      return ts.factory.updateArrowFunction(
        arrowNode, arrowNode.modifiers, arrowNode.typeParameters, arrowNode.parameters,
        arrowNode.type, arrowNode.equalsGreaterThanToken, processComponentBlock(blockNode, isLazy, log));
    } else {
      return ts.factory.updateArrowFunction(
        arrowNode, arrowNode.modifiers, arrowNode.typeParameters, arrowNode.parameters,
        arrowNode.type, arrowNode.equalsGreaterThanToken,
        processComponentBlock(body, isLazy, log, false, isInnerBuilder));
    }
  }
  return null;
}

function createRenderingInProgress(isTrue: boolean): ts.ExpressionStatement {
  return ts.factory.createExpressionStatement(ts.factory.createBinaryExpression(
    ts.factory.createPropertyAccessExpression(
      ts.factory.createThis(),
      ts.factory.createIdentifier(IS_RENDERING_IN_PROGRESS)
    ),
    ts.factory.createToken(ts.SyntaxKind.EqualsToken),
    isTrue ? ts.factory.createTrue() : ts.factory.createFalse()
  ));
}

function processIfStatement(node: ts.IfStatement, newStatements: ts.Statement[],
  log: LogInfo[], isInnerBuilder: boolean = false): void {
  const ifCreate: ts.ExpressionStatement = createIfCreate();
  const newIfNode: ts.IfStatement = processInnerIfStatement(node, 0, log, isInnerBuilder);
  const ifPop: ts.ExpressionStatement = createIfPop();
  newStatements.push(ifCreate, newIfNode, ifPop);
}

function processInnerIfStatement(node: ts.IfStatement, id: number, log: LogInfo[],
  isInnerBuilder: boolean = false): ts.IfStatement {
  if (ts.isIdentifier(node.expression) && node.expression.originalKeywordKind === undefined &&
    !node.expression.escapedText) {
    log.push({
      type: LogType.ERROR,
      message: 'Condition expression cannot be null in if statement.',
      pos: node.expression.getStart()
    });
    node = ts.factory.updateIfStatement(node, ts.factory.createIdentifier(COMPONENT_IF_UNDEFINED),
      node.thenStatement, node.elseStatement);
  }
  const newThenStatement: ts.Statement = processThenStatement(node.thenStatement, id, log, isInnerBuilder);
  const newElseStatement: ts.Statement = processElseStatement(node.elseStatement, id, log, isInnerBuilder);
  const newIfNode: ts.IfStatement = ts.factory.updateIfStatement(
    node, node.expression, newThenStatement, newElseStatement);
  return newIfNode;
}

function processThenStatement(thenStatement: ts.Statement, id: number,
  log: LogInfo[], isInnerBuilder: boolean = false): ts.Statement {
  if (ts.isExpressionStatement(thenStatement) && ts.isIdentifier(thenStatement.expression) &&
    thenStatement.expression.originalKeywordKind === undefined &&
    !thenStatement.expression.escapedText) {
    log.push({
      type: LogType.ERROR,
      message: 'Then statement cannot be null in if statement.',
      pos: thenStatement.expression.getStart()
    });
  }
  if (thenStatement) {
    if (ts.isBlock(thenStatement)) {
      thenStatement = processIfBlock(thenStatement, id, log, isInnerBuilder);
    } else if (ts.isIfStatement(thenStatement)) {
      thenStatement = processInnerIfStatement(thenStatement, 0, log, isInnerBuilder);
      thenStatement = ts.factory.createBlock(
        [createIfCreate(), createIfBranchId(id), thenStatement, createIfPop()], true);
    } else {
      thenStatement = ts.factory.createBlock([thenStatement], true);
      thenStatement = processIfBlock(thenStatement as ts.Block, id, log, isInnerBuilder);
    }
  }
  return thenStatement;
}

function processElseStatement(elseStatement: ts.Statement, id: number,
  log: LogInfo[], isInnerBuilder: boolean = false): ts.Statement {
  if (elseStatement) {
    if (ts.isBlock(elseStatement)) {
      elseStatement = processIfBlock(elseStatement, id + 1, log);
    } else if (ts.isIfStatement(elseStatement)) {
      elseStatement = processInnerIfStatement(elseStatement, id + 1, log, isInnerBuilder);
    } else {
      elseStatement = ts.factory.createBlock([elseStatement], true);
      elseStatement = processIfBlock(elseStatement as ts.Block, id + 1, log, isInnerBuilder);
    }
  }
  return elseStatement;
}

function processIfBlock(block: ts.Block, id: number, log: LogInfo[], isInnerBuilder: boolean = false): ts.Block {
  return addIfBranchId(id, processComponentBlock(block, false, log, false, isInnerBuilder));
}

function addIfBranchId(id: number, container: ts.Block): ts.Block {
  return ts.factory.updateBlock(container, [createIfBranchId(id), ...container.statements]);
}

function createIf(): ts.Identifier {
  return ts.factory.createIdentifier(COMPONENT_IF);
}

function createIfCreate(): ts.ExpressionStatement {
  return ts.factory.createExpressionStatement(createFunction(createIf(),
    ts.factory.createIdentifier(COMPONENT_CREATE_FUNCTION), ts.factory.createNodeArray([])));
}

function createIfPop(): ts.ExpressionStatement {
  return ts.factory.createExpressionStatement(createFunction(createIf(),
    ts.factory.createIdentifier(COMPONENT_POP_FUNCTION), null));
}

function createIfBranchId(id: number): ts.ExpressionStatement {
  return ts.factory.createExpressionStatement(createFunction(createIf(),
    ts.factory.createIdentifier(COMPONENT_IF_BRANCH_ID_FUNCTION),
    ts.factory.createNodeArray([ts.factory.createNumericLiteral(id)])));
}

interface CreateResult {
  newNode: ts.ExpressionStatement;
  identifierNode: ts.Identifier;
  isContainerComponent: boolean;
  isButton: boolean;
  needPop: boolean;
}

function createComponent(node: ts.ExpressionStatement, type: string): CreateResult {
  const res: CreateResult = {
    newNode: node,
    identifierNode: null,
    isContainerComponent: false,
    isButton: false,
    needPop: false
  };
  let identifierNode: ts.Identifier = ts.factory.createIdentifier(type);
  let temp: any = node.expression;
  while (temp && !ts.isIdentifier(temp) && temp.expression) {
    temp = temp.expression;
  }
  if (temp && temp.parent && (ts.isCallExpression(temp.parent) ||
    ts.isEtsComponentExpression(temp.parent)) && ts.isIdentifier(temp)) {
    if (temp.getText() === COMPONENT_BUTTON && type !== COMPONENT_POP_FUNCTION) {
      res.isButton = true;
      identifierNode = type === COMPONENT_CREATE_CHILD_FUNCTION
        ? ts.factory.createIdentifier(COMPONENT_CREATE_CHILD_FUNCTION)
        : ts.factory.createIdentifier(COMPONENT_CREATE_LABEL_FUNCTION);
    }
    if (NEEDPOP_COMPONENT.has(temp.getText())) {
      res.needPop = true;
    }
    if (BUILDIN_CONTAINER_COMPONENT.has(temp.getText())) {
      res.isContainerComponent = true;
    }
    res.newNode = type === COMPONENT_POP_FUNCTION
      ? ts.factory.updateExpressionStatement(node,
        createFunction(temp, identifierNode, null))
      : ts.factory.updateExpressionStatement(node,
        createFunction(temp, identifierNode, temp.parent.arguments));
    res.identifierNode = temp;
  }
  return res;
}

interface AnimationInfo {
  statement: ts.Statement,
  kind: boolean
}

export function bindComponentAttr(node: ts.ExpressionStatement, identifierNode: ts.Identifier,
  newStatements: ts.Statement[], log: LogInfo[], reverse: boolean = true,
  isStylesAttr: boolean = false, isGlobalStyles: boolean = false): void {
  let temp: any = node.expression;
  const statements: ts.Statement[] = [];
  const lastStatement: AnimationInfo = { statement: null, kind: false };
  if (ts.isPropertyAccessExpression(temp)) {
    log.push({
      type: LogType.ERROR,
      message: `'${node.getText()}' does not meet UI component syntax.`,
      pos: node.getStart()
    });
  }
  while (temp && ts.isCallExpression(temp) && temp.expression) {
    let flag: boolean = false;
    if (temp.expression && (validatePropertyAccessExpressionWithCustomBuilder(temp.expression) ||
      validateIdentifierWithCustomBuilder(temp.expression))) {
      let propertyName: string = '';
      if (ts.isIdentifier(temp.expression)) {
        propertyName = temp.expression.escapedText.toString();
      } else if (ts.isPropertyAccessExpression(temp.expression)) {
        propertyName = temp.expression.name.escapedText.toString();
      }
      switch (true) {
        case BIND_POPUP_SET.has(propertyName):
          temp = processBindPopupBuilder(temp);
          break;
        case BIND_DRAG_SET.has(propertyName):
          temp = processDragStartBuilder(temp);
          break;
        default:
          temp = processCustomBuilderProperty(temp);
      }
      flag = true;
    }
    if (ts.isPropertyAccessExpression(temp.expression) &&
      temp.expression.name && ts.isIdentifier(temp.expression.name) &&
      !componentCollection.customComponents.has(temp.expression.name.getText())) {
      addComponentAttr(temp, temp.expression.name, lastStatement, statements, identifierNode, log,
        isStylesAttr, isGlobalStyles);
      temp = temp.expression.expression;
      flag = true;
    } else if (ts.isIdentifier(temp.expression)) {
      if (!INNER_COMPONENT_NAMES.has(temp.expression.getText()) &&
        !GESTURE_TYPE_NAMES.has(temp.expression.getText()) &&
        !componentCollection.customComponents.has(temp.expression.getText())) {
        addComponentAttr(temp, temp.expression, lastStatement, statements, identifierNode, log,
          isStylesAttr, isGlobalStyles);
      }
      break;
    }
    if (!flag) {
      temp = temp.expression;
    }
  }
  if (lastStatement.statement && lastStatement.kind) {
    statements.push(lastStatement.statement);
  }
  if (statements.length) {
    reverse ? newStatements.push(...statements.reverse()) : newStatements.push(...statements);
  }
}

function processCustomBuilderProperty(node: ts.CallExpression): ts.CallExpression {
  const newArguments: ts.Expression[] = [];
  node.arguments.forEach((argument: ts.Expression | ts.Identifier, index: number) => {
    if (index === 0 && isBuilderChangeNode(argument)) {
      newArguments.push(parseBuilderNode(argument));
    } else {
      newArguments.push(argument);
    }
  });
  node = ts.factory.updateCallExpression(node, node.expression, node.typeArguments, newArguments);
  return node;
}

function isBuilderChangeNode(argument: ts.Node): boolean {
  return ts.isPropertyAccessExpression(argument) && argument.name && ts.isIdentifier(argument.name)
    && CUSTOM_BUILDER_METHOD.has(argument.name.getText()) ||
    ts.isCallExpression(argument) && argument.expression && argument.expression.name &&
    ts.isIdentifier(argument.expression.name) &&
    CUSTOM_BUILDER_METHOD.has(argument.expression.name.getText()) || ts.isIdentifier(argument) &&
    argument.escapedText && CUSTOM_BUILDER_METHOD.has(argument.escapedText.toString());
}

function parseBuilderNode(node: ts.Node): ts.ObjectLiteralExpression {
  if (isPropertyAccessExpressionNode(node)) {
    return processPropertyBuilder(node as ts.PropertyAccessExpression);
  } else if (ts.isIdentifier(node) && CUSTOM_BUILDER_METHOD.has(node.escapedText.toString())) {
    return processIdentifierBuilder(node);
  } else if (ts.isCallExpression(node)) {
    return getParsedBuilderAttrArgumentWithParams(node);
  }
}

function isPropertyAccessExpressionNode(node: ts.Node): boolean {
  return ts.isPropertyAccessExpression(node) && node.expression &&
    node.expression.kind === ts.SyntaxKind.ThisKeyword && node.name && ts.isIdentifier(node.name) &&
    CUSTOM_BUILDER_METHOD.has(node.name.escapedText.toString());
}

function processBindPopupBuilder(node: ts.CallExpression): ts.CallExpression {
  const newArguments: ts.Expression[] = [];
  node.arguments.forEach((argument: ts.ObjectLiteralExpression, index: number) => {
    if (index === 1) {
      // @ts-ignore
      newArguments.push(processBindPopupBuilderProperty(argument));
    } else {
      newArguments.push(argument);
    }
  });
  node = ts.factory.updateCallExpression(node, node.expression, node.typeArguments, newArguments);
  return node;
}

function processDragStartBuilder(node: ts.CallExpression): ts.CallExpression {
  const newStatements: ts.Statement[] = [];
  if (isNodeFunction(node)) {
    // @ts-ignore
    for (let i = 0; i < node.arguments[0].body.statements.length; i++) {
      // @ts-ignore
      const statement: ts.Statement = node.arguments[0].body.statements[i];
      newStatements.push(checkStatement(statement));
    }
    node = ts.factory.updateCallExpression(node, node.expression, node.typeArguments, [ts.factory.updateArrowFunction(
      // @ts-ignore
      node.arguments[0], undefined, undefined, node.arguments[0].parameters, node.arguments[0].type,
      // @ts-ignore
      node.arguments[0].equalsGreaterThanToken, ts.factory.updateBlock(node.arguments[0].body, newStatements))]);
  }
  return node;
}

function isNodeFunction(node: ts.CallExpression): boolean {
  return node.arguments && node.arguments.length && ts.isArrowFunction(node.arguments[0]) && node.arguments[0].body &&
    ts.isBlock(node.arguments[0].body);
}

function checkStatement(statement: ts.Statement): ts.Statement {
  if (ts.isReturnStatement(statement)) {
    if (ts.isObjectLiteralExpression(statement.expression)) {
      const newProperties: ts.ObjectLiteralElementLike[] = [];
      for (let j = 0; j < statement.expression.properties.length; j++) {
        const property: ts.ObjectLiteralElementLike = statement.expression.properties[j];
        checkProperty(property);
        newProperties.push(property);
      }
      return ts.factory.createReturnStatement(ts.factory.createObjectLiteralExpression(newProperties));
    } else {
      return ts.factory.updateReturnStatement(statement, parseBuilderNode(statement.expression));
    }
  } else {
    return statement;
  }
}

function checkProperty(property: ts.ObjectLiteralElementLike): void {
  if (isPropertyFunction(property)) {
    // @ts-ignore
    property = ts.factory.createPropertyAssignment(property.name, parseBuilderNode(property.initializer));
  }
}

function isPropertyFunction(property: ts.ObjectLiteralElementLike): boolean {
  return ts.isPropertyAssignment(property) && property.name && ts.isIdentifier(property.name) &&
    property.name.escapedText.toString() === BUILDER_ATTR_NAME;
}

function processBindPopupBuilderProperty(node: ts.ObjectLiteralExpression): ts.ObjectLiteralExpression {
  const newProperties: ts.PropertyAssignment[] = [];
  node.properties.forEach((property: ts.PropertyAssignment, index: number) => {
    if (index === 0) {
      if (property.name && ts.isIdentifier(property.name) &&
        property.name.escapedText.toString() === CUSTOM_DIALOG_CONTROLLER_BUILDER) {
        newProperties.push(ts.factory.updatePropertyAssignment(property, property.name,
          parseBuilderNode(property.initializer)));
      } else {
        newProperties.push(property);
      }
    } else {
      newProperties.push(property);
    }
  });
  return ts.factory.updateObjectLiteralExpression(node, newProperties);
}

function processPropertyBuilder(node: ts.PropertyAccessExpression): ts.ObjectLiteralExpression {
  return ts.factory.createObjectLiteralExpression([
    ts.factory.createPropertyAssignment(
      ts.factory.createIdentifier(BUILDER_ATTR_NAME),
      ts.factory.createCallExpression(
        ts.factory.createPropertyAccessExpression(
          node,
          ts.factory.createIdentifier(BUILDER_ATTR_BIND)
        ),
        undefined,
        [ts.factory.createThis()]
      )
    )
  ]);
}

function processIdentifierBuilder(node: ts.Identifier): ts.ObjectLiteralExpression {
  return ts.factory.createObjectLiteralExpression([
    ts.factory.createPropertyAssignment(
      ts.factory.createIdentifier(BUILDER_ATTR_NAME),
      node
    )
  ]);
}

function getParsedBuilderAttrArgumentWithParams(node: ts.CallExpression):
  ts.ObjectLiteralExpression {
  return ts.factory.createObjectLiteralExpression([
    ts.factory.createPropertyAssignment(
      ts.factory.createIdentifier(BUILDER_ATTR_NAME),
      ts.factory.createArrowFunction(
        undefined,
        undefined,
        [],
        undefined,
        ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        ts.factory.createBlock(
          [ts.factory.createExpressionStatement(node)],
          true
        )
      )
    )
  ]);
}

function validatePropertyAccessExpressionWithCustomBuilder(node: ts.Node): boolean {
  return ts.isPropertyAccessExpression(node) && node.name &&
    ts.isIdentifier(node.name) && CUSTOM_BUILDER_PROPERTIES.has(node.name.escapedText.toString());
}

function validateIdentifierWithCustomBuilder(node: ts.Node): boolean {
  return ts.isIdentifier(node) && CUSTOM_BUILDER_PROPERTIES.has(node.escapedText.toString());
}

function createArrowFunctionFor$$($$varExp: ts.Expression): ts.ArrowFunction {
  return ts.factory.createArrowFunction(
    undefined, undefined,
    [ts.factory.createParameterDeclaration(
      undefined, undefined, undefined,
      ts.factory.createIdentifier($$_NEW_VALUE),
      undefined, undefined, undefined
    )],
    undefined,
    ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    ts.factory.createBlock(
      [ts.factory.createExpressionStatement(ts.factory.createBinaryExpression(
        $$varExp,
        ts.factory.createToken(ts.SyntaxKind.EqualsToken),
        ts.factory.createIdentifier($$_NEW_VALUE)
      ))],
      false
    )
  );
}

function updateArgumentFor$$(argument: any): ts.Expression {
  if (ts.isElementAccessExpression(argument)) {
    return ts.factory.updateElementAccessExpression(
      argument, updateArgumentFor$$(argument.expression), argument.argumentExpression);
  } else if (ts.isIdentifier(argument)) {
    props.push(argument.getText());
    if (argument.getText() === $$_THIS) {
      return ts.factory.createThis();
    } else if (argument.getText().match(/^\$\$(.|\n)+/)) {
      return ts.factory.createIdentifier(argument.getText().replace(/\$\$/, ''));
    }
  } else if (ts.isPropertyAccessExpression(argument)) {
    return ts.factory.updatePropertyAccessExpression(
      argument, updateArgumentFor$$(argument.expression), argument.name);
  }
}

function verifyComponentId(temp: any, node: ts.Identifier, propName: string,
  log: LogInfo[]): void {
  if (!newsupplement.isAcceleratePreview && propName === ATTRIBUTE_ID) {
    const id: string = temp.arguments[0].text;
    const posOfNode: ts.LineAndCharacter = transformLog.sourceFile
      .getLineAndCharacterOfPosition(getRealNodePos(node));
    const curFileName: string = transformLog.sourceFile.fileName.replace(/\.ts$/, '');
    const rPath: string = path.resolve(projectConfig.projectPath, curFileName)
      .replace(/\\+/g, '/');
    const rLine: number = posOfNode.line + 1;
    const rCol: number = posOfNode.character + 1;
    if (ID_ATTRS.has(id)) {
      const idInfo: Map<string, string | number> = ID_ATTRS.get(id);
      if (!(idInfo.get('path') === rPath &&
        idInfo.get('line') === rLine &&
        idInfo.get('col') === rCol)) {
        log.push({
          type: LogType.WARN,
          message: `The current component id "${id}" is duplicate with ` +
            `${idInfo.get('path')}:${idInfo.get('line')}:${idInfo.get('col')}.`,
          pos: node.pos
        });
      }
    } else {
      ID_ATTRS.set(id, new Map().set('path', rPath)
        .set('line', rLine)
        .set('col', rCol));
    }
  }
}

function addComponentAttr(temp: any, node: ts.Identifier, lastStatement: any,
  statements: ts.Statement[], identifierNode: ts.Identifier, log: LogInfo[],
  isStylesAttr: boolean, isGlobalStyles: boolean): void {
  const propName: string = node.getText();
  verifyComponentId(temp, node, propName, log);
  if (propName === ATTRIBUTE_ANIMATION) {
    if (!lastStatement.statement) {
      if (!(temp.arguments.length === 1 &&
        temp.arguments[0].kind === ts.SyntaxKind.NullKeyword)) {
        statements.push(ts.factory.createExpressionStatement(createFunction(
          ts.factory.createIdentifier(GLOBAL_CONTEXT), node,
          // @ts-ignore
          [ts.factory.createNull()])));
      }
    } else {
      statements.push(lastStatement.statement);
    }
    lastStatement.statement = ts.factory.createExpressionStatement(createFunction(
      ts.factory.createIdentifier(GLOBAL_CONTEXT), node, temp.arguments));
    lastStatement.kind = false;
  } else if (GESTURE_ATTRS.has(propName)) {
    parseGesture(temp, propName, statements, log);
    lastStatement.kind = true;
  } else if (isExtendFunctionNode(identifierNode, propName)) {
    statements.push(ts.factory.createExpressionStatement(ts.factory.createCallExpression(
      ts.factory.createIdentifier(`__${identifierNode.escapedText.toString()}__${propName}`),
      undefined, temp.arguments)));
    lastStatement.kind = true;
  } else if (propName === ATTRIBUTE_STATESTYLES) {
    if (temp.arguments.length === 1 && ts.isObjectLiteralExpression(temp.arguments[0])) {
      statements.push(createViewStackProcessor(temp, true));
      traverseStateStylesAttr(temp, statements, identifierNode, log);
      lastStatement.kind = true;
    } else {
      validateStateStyleSyntax(temp, log);
    }
  } else if (GLOBAL_STYLE_FUNCTION.has(propName) || INNER_STYLE_FUNCTION.has(propName)) {
    const styleBlock: ts.Block =
      GLOBAL_STYLE_FUNCTION.get(propName) || INNER_STYLE_FUNCTION.get(propName);
    if (GLOBAL_STYLE_FUNCTION.has(propName)) {
      bindComponentAttr(styleBlock.statements[0] as ts.ExpressionStatement, identifierNode,
        statements, log, false, true, true);
    } else {
      bindComponentAttr(styleBlock.statements[0] as ts.ExpressionStatement, identifierNode,
        statements, log, false, true, false);
    }
    lastStatement.kind = true;
  } else if (isDoubleDollarToChange(isStylesAttr, identifierNode, propName, temp)) {
    const argumentsArr: ts.Expression[] = [];
    classifyArgumentsNum(temp.arguments, argumentsArr, propName, identifierNode);
    statements.push(ts.factory.createExpressionStatement(
      createFunction(identifierNode, node, argumentsArr)));
    lastStatement.kind = true;
  } else {
    if (isStylesAttr) {
      if (!COMMON_ATTRS.has(propName)) {
        validateStateStyleSyntax(temp, log);
      }
    }
    temp = loopEtscomponent(temp, isStylesAttr, isGlobalStyles);
    statements.push(ts.factory.createExpressionStatement(
      createFunction(identifierNode, node, temp.arguments)));
    lastStatement.kind = true;
  }
}

function isDoubleDollarToChange(isStylesAttr: boolean, identifierNode: ts.Identifier,
  propName: string, temp: any): boolean {
  return !isStylesAttr &&
    PROPERTIES_ADD_DOUBLE_DOLLAR.has(identifierNode.escapedText.toString()) &&
    PROPERTIES_ADD_DOUBLE_DOLLAR.get(identifierNode.escapedText.toString()).has(propName) ||
    STYLE_ADD_DOUBLE_DOLLAR.has(propName) && temp.arguments.length && temp.arguments[0] ?
    temp.arguments[0].getText().match(/^\$\$(.|\n)+/) !== null
    : false;
}

function processDollarEtsComponent(node: ts.EtsComponentExpression, name: string
): ts.EtsComponentExpression {
  node.arguments.forEach((item: ts.Node, index: number) => {
    if (ts.isObjectLiteralExpression(item) && item.properties && item.properties.length) {
      item.properties.forEach((param: ts.PropertyAssignment, paramIndex: number) => {
        if (isHaveDoubleDollar(param, name)) {
          const varExp: ts.Expression = updateArgumentFor$$(param.initializer);
          node.arguments[index].properties[paramIndex].initializer = generateObjectFor$$(varExp);
        }
      });
    }
  });
  return node;
}

function isHaveDoubleDollar(param: ts.PropertyAssignment, name: string): boolean {
  return ts.isPropertyAssignment(param) && param.name && ts.isIdentifier(param.name) &&
    PROPERTIES_ADD_DOUBLE_DOLLAR.get(name).has(param.name.getText()) && param.initializer &&
    param.initializer.getText().startsWith($$);
}

function loopEtscomponent(node: any, isStylesAttr: boolean, isGlobalStyles: boolean): ts.Node {
  node.arguments.forEach((item: ts.Node, index: number) => {
    if (isStylesAttr && isGlobalStyles) {
      node.arguments[index] = traverseStylesAttr(item);
    }
    if (ts.isEtsComponentExpression(item)) {
      node.arguments[index] = ts.factory.createCallExpression(
        item.expression, undefined, item.arguments);
    } else if (ts.isCallExpression(item) || ts.isNewExpression(item)) {
      node.arguments[index] = ts.visitEachChild(item,
        changeEtsComponentKind, contextGlobal);
    }
  });
  return node;
}

function changeEtsComponentKind(node: ts.Node): ts.Node {
  if (ts.isEtsComponentExpression(node)) {
    node.kind = 204;
    return node;
  }
  return ts.visitEachChild(node, changeEtsComponentKind, contextGlobal);
}

function classifyArgumentsNum(args: any, argumentsArr: ts.Expression[], propName: string,
  identifierNode: ts.Identifier): void {
  if (STYLE_ADD_DOUBLE_DOLLAR.has(propName) && args.length === 2) {
    const varExp: ts.Expression = updateArgumentFor$$(args[0]);
    argumentsArr.push(generateObjectFor$$(varExp), args[1]);
  } else if (PROPERTIES_ADD_DOUBLE_DOLLAR.has(identifierNode.getText()) && args.length === 1 &&
    PROPERTIES_ADD_DOUBLE_DOLLAR.get(identifierNode.getText()).has(propName) ||
    STYLE_ADD_DOUBLE_DOLLAR.has(propName) && args.length === 1) {
    const varExp: ts.Expression = updateArgumentFor$$(args[0]);
    argumentsArr.push(varExp, createArrowFunctionFor$$(varExp));
  }
}

function traverseStylesAttr(node: ts.Node): ts.Node {
  if (ts.isStringLiteral(node)) {
    node = ts.factory.createStringLiteral(node.text);
  } else if (ts.isNumericLiteral(node)) {
    node = ts.factory.createNumericLiteral(node.text);
  }
  return ts.visitEachChild(node, childNode => traverseStylesAttr(childNode), contextGlobal);
}

function generateObjectFor$$(varExp: ts.Expression): ts.ObjectLiteralExpression {
  return ts.factory.createObjectLiteralExpression(
    [
      ts.factory.createPropertyAssignment(
        ts.factory.createIdentifier($$_VALUE),
        varExp
      ),
      ts.factory.createPropertyAssignment(
        ts.factory.createIdentifier($$_CHANGE_EVENT),
        createArrowFunctionFor$$(varExp)
      )
    ],
    false
  );
}

function createViewStackProcessor(item: any, endViewStack: boolean): ts.ExpressionStatement {
  const argument: ts.StringLiteral[] = [];
  if (!endViewStack && item.name) {
    argument.push(ts.factory.createStringLiteral(item.name.getText()));
  }
  return ts.factory.createExpressionStatement(ts.factory.createCallExpression(
    ts.factory.createPropertyAccessExpression(
      ts.factory.createIdentifier(VIEW_STACK_PROCESSOR),
      ts.factory.createIdentifier(VISUAL_STATE)
    ),
    undefined,
    argument
  ));
}

function traverseStateStylesAttr(temp: any, statements: ts.Statement[],
  identifierNode: ts.Identifier, log: LogInfo[]): void {
  temp.arguments[0].properties.reverse().forEach((item: ts.PropertyAssignment) => {
    if (ts.isPropertyAccessExpression(item.initializer) &&
      item.initializer.expression.getText() === THIS &&
      INNER_STYLE_FUNCTION.get(item.initializer.name.getText())) {
      const name: string = item.initializer.name.getText();
      bindComponentAttr(INNER_STYLE_FUNCTION.get(name).statements[0] as ts.ExpressionStatement,
        identifierNode, statements, log, false, true);
    } else if (ts.isIdentifier(item.initializer) &&
      GLOBAL_STYLE_FUNCTION.get(item.initializer.getText())) {
      const name: string = item.initializer.getText();
      bindComponentAttr(GLOBAL_STYLE_FUNCTION.get(name).statements[0] as ts.ExpressionStatement,
        identifierNode, statements, log, false, true);
    } else if (ts.isObjectLiteralExpression(item.initializer) &&
      item.initializer.properties.length === 1 &&
      ts.isPropertyAssignment(item.initializer.properties[0])) {
      bindComponentAttr(ts.factory.createExpressionStatement(
        item.initializer.properties[0].initializer), identifierNode, statements, log, false, true);
    } else {
      if (!(ts.isObjectLiteralExpression(item.initializer) && item.initializer.properties.length === 0)) {
        validateStateStyleSyntax(temp, log);
      } 
    }
    if (item.name) {
      statements.push(createViewStackProcessor(item, false));
    }
  });
}

function isExtendFunctionNode(identifierNode: ts.Identifier, propName: string): boolean {
  if (identifierNode && EXTEND_ATTRIBUTE.has(identifierNode.escapedText.toString())) {
    const attributeArray: string[] =
      [...EXTEND_ATTRIBUTE.get(identifierNode.escapedText.toString())];
    if (attributeArray.includes(propName)) {
      return true;
    }
  }
  return false;
}

const gestureMap: Map<string, string> = new Map([
  [PRIORITY_GESTURE_ATTRIBUTE, GESTURE_ENUM_VALUE_HIGH],
  [PARALLEL_GESTURE_ATTRIBUTE, GESTURE_ENUM_VALUE_PARALLEL],
  [GESTURE_ATTRIBUTE, GESTURE_ENUM_VALUE_LOW]
]);

function parseGesture(node: ts.CallExpression, propName: string, statements: ts.Statement[],
  log: LogInfo[]): void {
  statements.push(ts.factory.createExpressionStatement(
    createFunction(ts.factory.createIdentifier(COMPONENT_GESTURE),
      ts.factory.createIdentifier(COMPONENT_POP_FUNCTION), null)));
  parseGestureInterface(node, statements, log);
  const argumentArr: ts.NodeArray<ts.PropertyAccessExpression> = ts.factory.createNodeArray(
    [ts.factory.createPropertyAccessExpression(
      ts.factory.createIdentifier(GESTURE_ENUM_KEY),
      ts.factory.createIdentifier(gestureMap.get(propName)))
    ]
  );
  if (node.arguments && node.arguments.length > 1 &&
    ts.isPropertyAccessExpression(node.arguments[1])) {
    // @ts-ignore
    argumentArr.push(node.arguments[1]);
  }
  statements.push(ts.factory.createExpressionStatement(
    createFunction(ts.factory.createIdentifier(COMPONENT_GESTURE),
      ts.factory.createIdentifier(COMPONENT_CREATE_FUNCTION), argumentArr)));
}

function processGestureType(node: ts.CallExpression, statements: ts.Statement[], log: LogInfo[],
  reverse: boolean = false): void {
  const newStatements: ts.Statement[] = [];
  const newNode: ts.ExpressionStatement = ts.factory.createExpressionStatement(node);
  let temp: any = node.expression;
  while (temp && !ts.isIdentifier(temp) && temp.expression) {
    temp = temp.expression;
  }
  if (temp && temp.parent && ts.isCallExpression(temp.parent) && ts.isIdentifier(temp) &&
    GESTURE_TYPE_NAMES.has(temp.escapedText.toString())) {
    newStatements.push(ts.factory.createExpressionStatement(
      createFunction(temp, ts.factory.createIdentifier(COMPONENT_POP_FUNCTION), null)));
    if (temp.escapedText.toString() === COMPONENT_GESTURE_GROUP) {
      const gestureStatements: ts.Statement[] = [];
      parseGestureInterface(temp.parent, gestureStatements, log, true);
      newStatements.push(...gestureStatements.reverse());
      bindComponentAttr(newNode, temp, newStatements, log, false);
      let argumentArr: ts.NodeArray<ts.Expression> = null;
      if (temp.parent.arguments && temp.parent.arguments.length) {
        // @ts-ignore
        argumentArr = ts.factory.createNodeArray([temp.parent.arguments[0]]);
      }
      newStatements.push(ts.factory.createExpressionStatement(
        createFunction(temp, ts.factory.createIdentifier(COMPONENT_CREATE_FUNCTION), argumentArr)));
    } else {
      bindComponentAttr(newNode, temp, newStatements, log, false);
      newStatements.push(ts.factory.createExpressionStatement(
        createFunction(temp, ts.factory.createIdentifier(COMPONENT_CREATE_FUNCTION), temp.parent.arguments)));
    }
  }
  if (newStatements.length) {
    reverse ? statements.push(...newStatements.reverse()) : statements.push(...newStatements);
  }
}

function parseGestureInterface(node: ts.CallExpression, statements: ts.Statement[], log: LogInfo[],
  reverse: boolean = false): void {
  if (node.arguments && node.arguments.length) {
    node.arguments.forEach((item: ts.Node) => {
      if (ts.isCallExpression(item)) {
        processGestureType(item, statements, log, reverse);
      }
    });
  }
}

export function getName(node: ts.ExpressionStatement | ts.Expression): string {
  // @ts-ignore
  let temp: any = node.expression;
  let name: string;
  while (temp) {
    if (ts.isIdentifier(temp) && temp.parent && (ts.isCallExpression(temp.parent) ||
      ts.isEtsComponentExpression(temp.parent))) {
      name = temp.escapedText.toString();
      break;
    } else if (ts.isPropertyAccessExpression(temp) && temp.name && ts.isIdentifier(temp.name) &&
      isCustomAttributes(temp)) {
      name = temp.name.escapedText.toString();
      break;
    }
    temp = temp.expression;
  }
  return name;
}

function isCustomAttributes(temp: ts.PropertyAccessExpression): boolean {
  if (temp.expression && temp.expression.getText() === THIS) {
    return true;
  } else {
    return !BUILDIN_STYLE_NAMES.has(temp.name.escapedText.toString());
  }
}

export function isAttributeNode(node: ts.ExpressionStatement): boolean {
  let temp: any = node.expression;
  let name: string;
  while (temp) {
    if (ts.isCallExpression(temp) && temp.expression && ts.isIdentifier(temp.expression)) {
      name = temp.expression.escapedText.toString();
      break;
    }
    temp = temp.expression;
  }
  return BUILDIN_STYLE_NAMES.has(name);
}

enum ComponentType {
  innerComponent,
  customComponent,
  forEachComponent,
  customBuilderMethod,
  builderParamMethod,
  function
}

function isEtsComponent(node: ts.ExpressionStatement): boolean {
  let isEtsComponent: boolean = false;
  let temp: any = node.expression;
  while (temp) {
    if (ts.isEtsComponentExpression(temp)) {
      isEtsComponent = true;
    }
    temp = temp.expression;
  }
  return isEtsComponent;
}

function getComponentType(node: ts.ExpressionStatement, log: LogInfo[],
  name: string, parent: string): ComponentType {
  if (isEtsComponent(node)) {
    if (componentCollection.customComponents.has(name)) {
      return ComponentType.customComponent;
    } else {
      return ComponentType.innerComponent;
    }
  } else if (componentCollection.customComponents.has(name)) {
    return ComponentType.customComponent;
  } else if (name === COMPONENT_FOREACH || name === COMPONENT_LAZYFOREACH) {
    return ComponentType.forEachComponent;
  } else if (CUSTOM_BUILDER_METHOD.has(name)) {
    return ComponentType.customBuilderMethod;
  } else if (builderParamObjectCollection.get(componentCollection.currentClassName) &&
    builderParamObjectCollection.get(componentCollection.currentClassName).has(name)) {
    return ComponentType.builderParamMethod;
  } else if (CUSTOM_BUILDER_METHOD.has(parent) && ts.isCallExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression)) {
    return ComponentType.function;
  } else if (!isAttributeNode(node)) {
    log.push({
      type: LogType.ERROR,
      message: `'${node.getText()}' does not meet UI component syntax.`,
      pos: node.getStart()
    });
  }
  return null;
}

export function validateStateStyleSyntax(temp: any, log: LogInfo[]): void {
  log.push({
    type: LogType.ERROR,
    message: `.stateStyles doesn't conform standard.`,
    pos: temp.getStart()
  });
}

function getEtsComponentExpression(node:ts.ExpressionStatement): ts.EtsComponentExpression {
  let current: any = node.expression;
  while (current) {
    if (ts.isEtsComponentExpression(current)) {
      return current;
    }
    current = current.expression;
  }
  return null;
}

function checkEtsComponent(node: ts.ExpressionStatement, log: LogInfo[]): void {
  const etsComponentExpression: ts.EtsComponentExpression = getEtsComponentExpression(node);
  if (etsComponentExpression) {
    checkAllNode(
      etsComponentExpression,
      new Set([...INNER_COMPONENT_NAMES, ...componentCollection.customComponents]),
      transformLog.sourceFile,
      log
    );
  }
}
