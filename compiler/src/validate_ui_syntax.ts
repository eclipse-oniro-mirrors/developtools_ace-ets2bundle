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
  INNER_COMPONENT_DECORATORS,
  COMPONENT_DECORATOR_ENTRY,
  COMPONENT_DECORATOR_PREVIEW,
  COMPONENT_DECORATOR_COMPONENT,
  COMPONENT_DECORATOR_CUSTOM_DIALOG,
  STRUCT,
  CLASS,
  NATIVE_MODULE,
  SYSTEM_PLUGIN,
  OHOS_PLUGIN,
  INNER_COMPONENT_MEMBER_DECORATORS,
  COMPONENT_FOREACH,
  COMPONENT_LAZYFOREACH,
  COMPONENT_STATE_DECORATOR,
  COMPONENT_LINK_DECORATOR,
  COMPONENT_PROP_DECORATOR,
  COMPONENT_STORAGE_PROP_DECORATOR,
  COMPONENT_STORAGE_LINK_DECORATOR,
  COMPONENT_PROVIDE_DECORATOR,
  COMPONENT_CONSUME_DECORATOR,
  COMPONENT_OBJECT_LINK_DECORATOR,
  COMPONENT_CONSTRUCTOR_ID,
  COMPONENT_CONSTRUCTOR_PARENT,
  COMPONENT_CONSTRUCTOR_PARAMS,
  COMPONENT_EXTEND_DECORATOR,
  COMPONENT_OBSERVED_DECORATOR,
  STYLES
} from './pre_define';
import {
  INNER_COMPONENT_NAMES,
  AUTOMIC_COMPONENT,
  SINGLE_CHILD_COMPONENT,
  SPECIFIC_CHILD_COMPONENT,
  BUILDIN_STYLE_NAMES,
  EXTEND_ATTRIBUTE,
  GLOBAL_STYLE_FUNCTION,
  STYLES_ATTRIBUTE
} from './component_map';
import {
  LogType,
  LogInfo,
  componentInfo,
  addLog,
  hasDecorator
} from './utils';
import { projectConfig } from '../main';
const parser = require('../syntax_parser/dist/exclude_comment.js');

export interface ComponentCollection {
  entryComponent: string;
  previewComponent: string;
  customDialogs: Set<string>;
  customComponents: Set<string>;
  currentClassName: string;
}

export interface IComponentSet {
  propertys: Set<string>;
  regulars: Set<string>;
  states: Set<string>;
  links: Set<string>;
  props: Set<string>;
  storageProps: Set<string>;
  storageLinks: Set<string>;
  provides: Set<string>;
  consumes: Set<string>;
  objectLinks: Set<string>;
}

export const componentCollection: ComponentCollection = {
  entryComponent: null,
  previewComponent: null,
  customDialogs: new Set([]),
  customComponents: new Set([]),
  currentClassName: null
};

export const observedClassCollection: Set<string> = new Set();
export const enumCollection: Set<string> = new Set();
export const classMethodCollection: Map<string, Set<string>> = new Map();
export const dollarCollection: Set<string> = new Set();

export const propertyCollection: Map<string, Set<string>> = new Map();
export const stateCollection: Map<string, Set<string>> = new Map();
export const linkCollection: Map<string, Set<string>> = new Map();
export const propCollection: Map<string, Set<string>> = new Map();
export const regularCollection: Map<string, Set<string>> = new Map();
export const storagePropCollection: Map<string, Set<string>> = new Map();
export const storageLinkCollection: Map<string, Set<string>> = new Map();
export const provideCollection: Map<string, Set<string>> = new Map();
export const consumeCollection: Map<string, Set<string>> = new Map();
export const objectLinkCollection: Map<string, Set<string>> = new Map();

export const isStaticViewCollection: Map<string, boolean> = new Map();

export const moduleCollection: Set<string> = new Set();

export function validateUISyntax(source: string, content: string, filePath: string,
  fileQuery: string): LogInfo[] {
  let log: LogInfo[] = [];
  if (path.basename(filePath) !== 'app.ets') {
    const res: LogInfo[] = checkComponentDecorator(source, filePath, fileQuery);
    if (res) {
      log = log.concat(res);
    }
    const allComponentNames: Set<string> =
      new Set([...INNER_COMPONENT_NAMES, ...componentCollection.customComponents]);
    checkUISyntax(filePath, allComponentNames, content, log);
    componentCollection.customComponents.forEach(item => componentInfo.componentNames.add(item));
  }

  return log;
}

function checkComponentDecorator(source: string, filePath: string,
  fileQuery: string): LogInfo[] | null {
  const log: LogInfo[] = [];
  const sourceFile: ts.SourceFile = ts.createSourceFile(filePath, source,
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sourceFile && sourceFile.statements && sourceFile.statements.length) {
    const result: DecoratorResult = {
      entryCount: 0,
      previewCount: 0
    };
    sourceFile.statements.forEach((item, index, arr) => {
      if (isObservedClass(item)) {
        // @ts-ignore
        observedClassCollection.add(item.name.getText());
      }
      if (ts.isEnumDeclaration(item) && item.name) {
        enumCollection.add(item.name.getText());
      }
      if (isStruct(item)) {
        if (index + 1 < arr.length && ts.isExpressionStatement(arr[index + 1]) &&
        // @ts-ignore
        arr[index + 1].expression && ts.isIdentifier(arr[index + 1].expression)) {
          if (ts.isExportAssignment(item) && hasComponentDecorator(item)) {
            checkDecorators(item, result, arr[index + 1] as ts.ExpressionStatement, log, sourceFile);
          } else if (index > 0 && hasComponentDecorator(arr[index - 1])) {
            checkDecorators(arr[index - 1] as ts.MissingDeclaration, result,
              arr[index + 1] as ts.ExpressionStatement, log, sourceFile);
          } else {
            // @ts-ignore
            const pos: number = item.expression.getStart();
            const message: string = `A struct should use decorator '@Component'.`;
            addLog(LogType.WARN, message, pos, log, sourceFile);
          }
        } else {
          // @ts-ignore
          const pos: number = item.expression.getStart();
          const message: string = `A struct must have a name.`;
          addLog(LogType.ERROR, message, pos, log, sourceFile);
        }
      }
      if (ts.isMissingDeclaration(item)) {
        const decorators: ts.NodeArray<ts.Decorator> = item.decorators;
        for (let i = 0; i < decorators.length; i++) {
          if (decorators[i] && /struct/.test(decorators[i].getText())) {
            const message: string = `Please use a valid decorator.`;
            addLog(LogType.ERROR, message, item.getStart(), log, sourceFile);
            break;
          }
        }
      }
      if (ts.isFunctionDeclaration(item) && item.decorators && item.decorators.length === 1 &&
        item.decorators[0].expression && item.decorators[0].expression.getText() === STYLES) {
        STYLES_ATTRIBUTE.add(item.name.getText())
        GLOBAL_STYLE_FUNCTION.set(item.name.getText(), item.body);
        BUILDIN_STYLE_NAMES.add(item.name.getText());
      }
    });
    validateEntryAndPreviewCount(result, fileQuery, sourceFile.fileName, projectConfig.isPreview, log);
  }

  return log.length ? log : null;
}

function validateEntryAndPreviewCount(result: DecoratorResult, fileQuery: string,
  fileName: string, isPreview: boolean, log: LogInfo[]): void {
  if (result.previewCount > 10 && fileQuery === '?entry') {
    log.push({
      type: LogType.ERROR,
      message: `A page can contain at most 10 '@Preview' decorators.`,
      fileName: fileName
    });
  }
  if (result.entryCount > 1 && fileQuery === '?entry') {
    log.push({
      type: LogType.ERROR,
      message: `A page can't contain more than one '@Entry' decorator`,
      fileName: fileName
    });
  }
  if (isPreview && result.previewCount < 1 && result.entryCount !== 1 &&
    fileQuery === '?entry') {
    log.push({
      type: LogType.ERROR,
      message: `A page configured in 'config.json' must have one and only one '@Entry' `
        + `decorator, or at least one '@Preview' decorator.`,
      fileName: fileName
    });
  } else if (!isPreview && result.entryCount !== 1 && fileQuery === '?entry') {
    log.push({
      type: LogType.ERROR,
      message: `A page configured in 'config.json' must have one and only one '@Entry' `
        + `decorator.`,
      fileName: fileName
    });
  }
}

export function isObservedClass(node: ts.Node): boolean {
  if (ts.isClassDeclaration(node) && hasDecorator(node, COMPONENT_OBSERVED_DECORATOR)) {
    return true;
  }
  return false;
}

export function isCustomDialogClass(node: ts.Node): boolean {
  if (ts.isClassDeclaration(node) && hasDecorator(node, COMPONENT_DECORATOR_CUSTOM_DIALOG)) {
    return true;
  }
  return false;
}

function isStruct(node: ts.Node): boolean {
  if ((ts.isExpressionStatement(node) || ts.isExportAssignment(node)) &&
    node.expression && ts.isIdentifier(node.expression) && node.expression.getText() === STRUCT) {
    return true;
  }
  return false;
}

function hasComponentDecorator(node: ts.Node): boolean {
  if ((ts.isMissingDeclaration(node) || ts.isExportAssignment(node)) &&
    node.decorators && node.decorators.length) {
    return true;
  }
  return false;
}

interface DecoratorResult {
  entryCount: number;
  previewCount: number;
}

function checkDecorators(node: ts.MissingDeclaration | ts.ExportAssignment, result: DecoratorResult,
  component: ts.ExpressionStatement, log: LogInfo[], sourceFile: ts.SourceFile): void {
  let hasComponentDecorator: boolean = false;
  const componentName: string = component.getText();
  node.decorators.forEach((element) => {
    const name: string = element.getText().replace(/\((.|\n)*\)/, '').trim();
    if (INNER_COMPONENT_DECORATORS.has(name)) {
      componentCollection.customComponents.add(componentName);
      switch (name) {
        case COMPONENT_DECORATOR_ENTRY:
          result.entryCount++;
          componentCollection.entryComponent = componentName;
          break;
        case COMPONENT_DECORATOR_PREVIEW:
          result.previewCount++;
          componentCollection.previewComponent = componentName;
          break;
        case COMPONENT_DECORATOR_COMPONENT:
          hasComponentDecorator = true;
          break;
        case COMPONENT_DECORATOR_CUSTOM_DIALOG:
          componentCollection.customDialogs.add(componentName);
          hasComponentDecorator = true;
          break;
      }
    } else {
      const pos: number = element.expression ? element.expression.pos : element.pos;
      const message: string = `The struct '${componentName}' use invalid decorator.`;
      addLog(LogType.WARN, message, pos, log, sourceFile);
    }
  });
  if (!hasComponentDecorator) {
    const message: string = `The struct '${componentName}' should use decorator '@Component'.`;
    addLog(LogType.WARN, message, component.pos, log, sourceFile);
  }
  if (BUILDIN_STYLE_NAMES.has(componentName)) {
    const message: string = `The struct '${componentName}' cannot have the same name ` +
      `as the built-in attribute '${componentName}'.`;
    addLog(LogType.ERROR, message, component.pos, log, sourceFile);
  }
  if (INNER_COMPONENT_NAMES.has(componentName)) {
    const message: string = `The struct '${componentName}' cannot have the same name ` +
      `as the built-in component '${componentName}'.`;
    addLog(LogType.ERROR, message, component.pos, log, sourceFile);
  }
}

function checkUISyntax(filePath: string, allComponentNames: Set<string>, content: string,
  log: LogInfo[]): void {
  const sourceFile: ts.SourceFile = ts.createSourceFile(filePath, content,
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  visitAllNode(sourceFile, sourceFile, allComponentNames, log);
}

function visitAllNode(node: ts.Node, sourceFileNode: ts.SourceFile, allComponentNames: Set<string>,
  log: LogInfo[]) {
  checkAllNode(node, allComponentNames, sourceFileNode, log);
  if (ts.isClassDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
    collectComponentProps(node);
  }
  node.getChildren().forEach((item: ts.Node) => visitAllNode(item, sourceFileNode, allComponentNames, log));
}

function checkAllNode(node: ts.Node, allComponentNames: Set<string>, sourceFileNode: ts.SourceFile,
  log: LogInfo[]): void {
  if (ts.isExpressionStatement(node) && node.expression && ts.isIdentifier(node.expression) &&
  allComponentNames.has(node.expression.escapedText.toString())) {
    const pos: number = node.expression.getStart();
    const message: string =
      `The component name must be followed by parentheses, like '${node.expression.getText()}()'.`;
    addLog(LogType.ERROR, message, pos, log, sourceFileNode);
  }
  checkNoChildComponent(node, sourceFileNode, log);
  checkOneChildComponent(node, allComponentNames, sourceFileNode, log);
  checkSpecificChildComponent(node, allComponentNames, sourceFileNode, log);
}

function checkNoChildComponent(node: ts.Node, sourceFileNode: ts.SourceFile, log: LogInfo[]): void {
  if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) && hasChild(node)) {
    const componentName: string = node.expression.expression.escapedText.toString();
    const pos: number = node.expression.expression.getStart();
    const message: string = `The component '${componentName}' can't have any child.`;
    addLog(LogType.ERROR, message, pos, log, sourceFileNode);
  }
}

function hasChild(node: ts.ExpressionStatement): boolean {
  const callExpression: ts.CallExpression = node.expression as ts.CallExpression;
  const nodeName: ts.Identifier = callExpression.expression as ts.Identifier;
  if (AUTOMIC_COMPONENT.has(nodeName.escapedText.toString()) && getNextNode(node)) {
    return true;
  }
  return false;
}

function getNextNode(node: ts.Node): ts.Block {
  if (node.parent && ts.isBlock(node.parent) && node.parent.statements) {
    const statementsArray: ts.Node[] = Array.from(node.parent.statements);
    for (let i = 0; i < statementsArray.length - 1; i++) {
      const curNode: ts.Node = statementsArray[i];
      const nextNode: ts.Node = statementsArray[i + 1];
      if (node === curNode && ts.isBlock(nextNode)) {
        return nextNode;
      }
    }
  }
}

function checkOneChildComponent(node: ts.Node, allComponentNames: Set<string>,
  sourceFileNode: ts.SourceFile, log: LogInfo[]): void {
  if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) && hasNonSingleChild(node, allComponentNames)) {
    const componentName: string = node.expression.expression.escapedText.toString();
    const pos: number = node.expression.expression.getStart();
    const message: string =
      `The component '${componentName}' can only have a single child component.`;
    addLog(LogType.ERROR, message, pos, log, sourceFileNode);
  }
}

function hasNonSingleChild(node: ts.ExpressionStatement, allComponentNames: Set<string>): boolean {
  const callExpression: ts.CallExpression = node.expression as ts.CallExpression;
  const nodeName: ts.Identifier = callExpression.expression as ts.Identifier;
  const nextBlockNode: ts.Block = getNextNode(node);
  if (SINGLE_CHILD_COMPONENT.has(nodeName.escapedText.toString())) {
    if (!nextBlockNode) {
      return false;
    }
    if (nextBlockNode && nextBlockNode.statements) {
      const length: number = nextBlockNode.statements.length;
      if (!length) {
        return false;
      }
      if (length > 3) {
        return true;
      }
      const childCount: number = getBlockChildrenCount(nextBlockNode, allComponentNames);
      if (childCount > 1) {
        return true;
      }
    }
  }
  return false;
}

function getBlockChildrenCount(blockNode: ts.Block, allComponentNames: Set<string>): number {
  let maxCount: number = 0;
  const length: number = blockNode.statements.length;
  for (let i = 0; i < length; ++i) {
    const item: ts.Node = blockNode.statements[i];
    if (ts.isExpressionStatement(item) && ts.isCallExpression(item.expression) &&
      isForEachComponent(item.expression)) {
      maxCount += 2;
    }
    if (ts.isIfStatement(item)) {
      maxCount += getIfChildrenCount(item, allComponentNames);
    }
    if (ts.isBlock(item)) {
      maxCount += getBlockChildrenCount(item, allComponentNames);
    }
    if (ts.isExpressionStatement(item) && ts.isCallExpression(item.expression)) {
      let newNode: any = item.expression;
      while (newNode.expression) {
        if (ts.isCallExpression(newNode) && ts.isIdentifier(newNode.expression) &&
        !isForEachComponent(newNode) && isComponent(newNode, allComponentNames)) {
          maxCount += 1;
          if (i + 1 < length && ts.isBlock(blockNode.statements[i + 1])) {
            ++i;
          }
        }
        newNode = newNode.expression;
      }
    }
    if (maxCount > 1) {
      break;
    }
  }
  return maxCount;
}

function isComponent(node: ts.CallExpression, allComponentNames: Set<string>): boolean {
  if (ts.isIdentifier(node.expression) &&
    allComponentNames.has(node.expression.escapedText.toString())) {
    return true;
  }
  return false;
}

function isForEachComponent(node: ts.CallExpression): boolean {
  if (ts.isIdentifier(node.expression)) {
    const componentName: string = node.expression.escapedText.toString();
    return componentName === COMPONENT_FOREACH || componentName === COMPONENT_LAZYFOREACH;
  }
  return false;
}

function getIfChildrenCount(ifNode: ts.IfStatement, allComponentNames: Set<string>): number {
  const maxCount: number =
    Math.max(getStatementCount(ifNode.thenStatement, allComponentNames),
      getStatementCount(ifNode.elseStatement, allComponentNames));
  return maxCount;
}

function getStatementCount(node: ts.Node, allComponentNames: Set<string>): number {
  let maxCount: number = 0;
  if (!node) {
    return maxCount;
  } else if (ts.isBlock(node)) {
    maxCount = getBlockChildrenCount(node, allComponentNames);
  } else if (ts.isIfStatement(node)) {
    maxCount = getIfChildrenCount(node, allComponentNames);
  } else if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) &&
    isForEachComponent(node.expression)) {
    maxCount = 2;
  } else if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) &&
    !isForEachComponent(node.expression) && isComponent(node.expression, allComponentNames)) {
    maxCount = 1;
  }
  return maxCount;
}

function checkSpecificChildComponent(node: ts.Node, allComponentNames: Set<string>,
  sourceFileNode: ts.SourceFile, log: LogInfo[]): void {
  if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) && hasNonspecificChild(node, allComponentNames)) {
    const componentName: string = node.expression.expression.escapedText.toString();
    const pos: number = node.expression.expression.getStart();
    const specificChildArray: string =
      Array.from(SPECIFIC_CHILD_COMPONENT.get(componentName)).join(' and ');
    const message: string =
      `The component '${componentName}' can only have the child component ${specificChildArray}.`;
    addLog(LogType.ERROR, message, pos, log, sourceFileNode);
  }
}

function hasNonspecificChild(node: ts.ExpressionStatement,
  allComponentNames: Set<string>): boolean {
  const callExpression: ts.CallExpression = node.expression as ts.CallExpression;
  const nodeName: ts.Identifier = callExpression.expression as ts.Identifier;
  const nodeNameString: string = nodeName.escapedText.toString();
  const blockNode: ts.Block = getNextNode(node);
  let isNonspecific: boolean = false;
  if (SPECIFIC_CHILD_COMPONENT.has(nodeNameString) && blockNode) {
    const specificChildSet: Set<string> = SPECIFIC_CHILD_COMPONENT.get(nodeNameString);
    isNonspecific = isNonspecificChildBlock(blockNode, specificChildSet, allComponentNames);
    if (isNonspecific) {
      return isNonspecific;
    }
  }
  return isNonspecific;
}

function isNonspecificChildBlock(blockNode: ts.Block, specificChildSet: Set<string>,
  allComponentNames: Set<string>): boolean {
  if (blockNode.statements) {
    const length: number = blockNode.statements.length;
    for (let i = 0; i < length; ++i) {
      const item: ts.Node = blockNode.statements[i];
      if (ts.isIfStatement(item) && isNonspecificChildIf(item, specificChildSet, allComponentNames)) {
        return true;
      }
      if (ts.isExpressionStatement(item) && ts.isCallExpression(item.expression) &&
        isForEachComponent(item.expression) &&
        isNonspecificChildForEach(item.expression, specificChildSet, allComponentNames)) {
        return true;
      }
      if (ts.isBlock(item) && isNonspecificChildBlock(item, specificChildSet, allComponentNames)) {
        return true;
      }
      if (ts.isExpressionStatement(item) && ts.isCallExpression(item.expression)) {
        let newNode: any = item.expression;
        while (newNode.expression) {
          if (ts.isCallExpression(newNode) && ts.isIdentifier(newNode.expression) &&
          !isForEachComponent(newNode) && isComponent(newNode, allComponentNames)) {
            const isNonspecific: boolean =
            isNonspecificChildNonForEach(item.expression, specificChildSet);
            if (isNonspecific) {
              return isNonspecific;
            }
            if (i + 1 < length && ts.isBlock(blockNode.statements[i + 1])) {
              ++i;
            }
          }
          newNode = newNode.expression;
        }
      }
    }
  }
  return false;
}

function isNonspecificChildIf(node: ts.IfStatement, specificChildSet: Set<string>,
  allComponentNames: Set<string>): boolean {
  return isNonspecificChildIfStatement(node.thenStatement, specificChildSet, allComponentNames) ||
    isNonspecificChildIfStatement(node.elseStatement, specificChildSet, allComponentNames);
}

function isNonspecificChildForEach(node: ts.CallExpression, specificChildSet: Set<string>,
  allComponentNames: Set<string>): boolean {
  if (ts.isCallExpression(node) && node.arguments &&
    node.arguments.length > 1 && ts.isArrowFunction(node.arguments[1])) {
    const arrowFunction: ts.ArrowFunction = node.arguments[1] as ts.ArrowFunction;
    const body: ts.Block | ts.CallExpression | ts.IfStatement =
      arrowFunction.body as ts.Block | ts.CallExpression | ts.IfStatement;
    if (!body) {
      return false;
    }
    if (ts.isBlock(body) && isNonspecificChildBlock(body, specificChildSet, allComponentNames)) {
      return true;
    }
    if (ts.isIfStatement(body) && isNonspecificChildIf(body, specificChildSet, allComponentNames)) {
      return true;
    }
    if (ts.isCallExpression(body) && isForEachComponent(body) &&
      isNonspecificChildForEach(body, specificChildSet, allComponentNames)) {
      return true;
    }
    if (ts.isCallExpression(body) && !isForEachComponent(body) &&
      isComponent(body, allComponentNames) &&
      isNonspecificChildNonForEach(body, specificChildSet)) {
      return true;
    }
  }
  return false;
}

function isNonspecificChildNonForEach(node: ts.CallExpression,
  specificChildSet: Set<string>): boolean {
  if (ts.isIdentifier(node.expression) &&
    !specificChildSet.has(node.expression.escapedText.toString())) {
    return true;
  }
  return false;
}

function isNonspecificChildIfStatement(node: ts.Node, specificChildSet: Set<string>,
  allComponentNames: Set<string>): boolean {
  if (!node) {
    return false;
  }
  if (ts.isBlock(node) && isNonspecificChildBlock(node, specificChildSet, allComponentNames)) {
    return true;
  }
  if (ts.isIfStatement(node) && isNonspecificChildIf(node, specificChildSet, allComponentNames)) {
    return true;
  }
  if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) &&
    isForEachComponent(node.expression) &&
    isNonspecificChildForEach(node.expression, specificChildSet, allComponentNames)) {
    return true;
  }
  if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) &&
    !isForEachComponent(node.expression) && isComponent(node.expression, allComponentNames) &&
    isNonspecificChildNonForEach(node.expression, specificChildSet)) {
    return true;
  }
  return false;
}

function collectComponentProps(node: ts.ClassDeclaration): void {
  const componentName: string = node.name.getText();
  const ComponentSet: IComponentSet = getComponentSet(node);
  propertyCollection.set(componentName, ComponentSet.propertys);
  stateCollection.set(componentName, ComponentSet.states);
  linkCollection.set(componentName, ComponentSet.links);
  propCollection.set(componentName, ComponentSet.props);
  regularCollection.set(componentName, ComponentSet.regulars);
  storagePropCollection.set(componentName, ComponentSet.storageProps);
  storageLinkCollection.set(componentName, ComponentSet.storageLinks);
  provideCollection.set(componentName, ComponentSet.provides);
  consumeCollection.set(componentName, ComponentSet.consumes);
  objectLinkCollection.set(componentName, ComponentSet.objectLinks);
}

export function getComponentSet(node: ts.ClassDeclaration): IComponentSet {
  const propertys: Set<string> = new Set();
  const states: Set<string> = new Set();
  const links: Set<string> = new Set();
  const props: Set<string> = new Set();
  const regulars: Set<string> = new Set();
  const storageProps: Set<string> = new Set();
  const storageLinks: Set<string> = new Set();
  const provides: Set<string> = new Set();
  const consumes: Set<string> = new Set();
  const objectLinks: Set<string> = new Set();
  traversalComponentProps(node, propertys, regulars, states, links, props, storageProps,
    storageLinks, provides, consumes, objectLinks);
  return {
    propertys, regulars, states, links, props, storageProps, storageLinks, provides,
    consumes, objectLinks
  };
}

function traversalComponentProps(node: ts.ClassDeclaration, propertys: Set<string>,
  regulars: Set<string>, states: Set<string>, links: Set<string>, props: Set<string>,
  storageProps: Set<string>, storageLinks: Set<string>, provides: Set<string>,
  consumes: Set<string>, objectLinks: Set<string>): void {
  let isStatic: boolean = true;
  if (node.members) {
    const currentMethodCollection: Set<string> = new Set();
    node.members.forEach(item => {
      if (ts.isPropertyDeclaration(item) && ts.isIdentifier(item.name)) {
        const propertyName: string = item.name.getText();
        propertys.add(propertyName);
        if (!item.decorators || !item.decorators.length) {
          regulars.add(propertyName);
        } else {
          isStatic = false;
          for (let i = 0; i < item.decorators.length; i++) {
            const decoratorName: string = item.decorators[i].getText().replace(/\(.*\)$/, '').trim();
            if (INNER_COMPONENT_MEMBER_DECORATORS.has(decoratorName)) {
              dollarCollection.add('$' + propertyName);
              collectionStates(decoratorName, propertyName, states, links, props, storageProps,
                storageLinks, provides, consumes, objectLinks);
            }
          }
        }
      }
      if (ts.isMethodDeclaration(item) && item.name && ts.isIdentifier(item.name)) {
        currentMethodCollection.add(item.name.getText());
      }
    });
    classMethodCollection.set(node.name.getText(), currentMethodCollection);
  }
  isStaticViewCollection.set(node.name.getText(), isStatic);
}

function collectionStates(decorator: string, name: string, states: Set<string>, links: Set<string>,
  props: Set<string>, storageProps: Set<string>, storageLinks: Set<string>, provides: Set<string>,
  consumes: Set<string>, objectLinks: Set<string>): void {
  switch (decorator) {
    case COMPONENT_STATE_DECORATOR:
      states.add(name);
      break;
    case COMPONENT_LINK_DECORATOR:
      links.add(name);
      break;
    case COMPONENT_PROP_DECORATOR:
      props.add(name);
      break;
    case COMPONENT_STORAGE_PROP_DECORATOR:
      storageProps.add(name);
      break;
    case COMPONENT_STORAGE_LINK_DECORATOR:
      storageLinks.add(name);
      break;
    case COMPONENT_PROVIDE_DECORATOR:
      provides.add(name);
      break;
    case COMPONENT_CONSUME_DECORATOR:
      consumes.add(name);
      break;
    case COMPONENT_OBJECT_LINK_DECORATOR:
      objectLinks.add(name);
      break;
  }
}

export interface ReplaceResult {
  content: string,
  log: LogInfo[]
}

export function sourceReplace(source: string, sourcePath: string): ReplaceResult {
  let content: string = source;
  const log: LogInfo[] = [];
  // replace struct->class
  content = content.replace(
    new RegExp('\\b' + STRUCT + '\\b.+\\{', 'g'), item => {
      item = item.replace(new RegExp('\\b' + STRUCT + '\\b', 'g'), `${CLASS} `);
      return `${item} constructor(${COMPONENT_CONSTRUCTOR_ID}?, ${COMPONENT_CONSTRUCTOR_PARENT}?, ${COMPONENT_CONSTRUCTOR_PARAMS}?) {}`;
    });

  content = preprocessExtend(content, sourcePath, log);
  // process @system.
  content = processSystemApi(content);

  return {
    content: content,
    log: log
  }
}

export function preprocessExtend(content: string, sourcePath: string, log: LogInfo[]): string {
  let syntaxCheckContent: string;
  let result: any;
  try {
    result = parser.parse(content);
    syntaxCheckContent = result.content;
    for (let i = 0; i < result.collect_extend.component.length; i++) {
      collectExtend(
        result.collect_extend.component[i],
        result.collect_extend.functionName[i],
        result.collect_extend.parameters[i]
      );
    }
  } catch (err) {
    result = err;
    log.push({
      type: LogType.ERROR,
      message: parser.SyntaxError.buildMessage(err.expected, err.found),
      line: err.location.start.line,
      column: err.location.start.column,
      fileName: sourcePath
    });
    syntaxCheckContent = content;
  }
  if (result.error_otherParsers) {
    for(let i = 0; i < result.error_otherParsers.length; i++) {
      log.push({
        type: LogType.ERROR,
        message: result.error_otherParsers[i].errMessage,
        line: result.error_otherParsers[i].errPosition.line,
        column: result.error_otherParsers[i].errPosition.column,
        fileName: sourcePath
      });
    }
  }
  return syntaxCheckContent;
}

function collectExtend(component: string, attribute: string, parameter: string): void {
  let parameterCount: number;
  if (parameter) {
    parameterCount = parameter.split(',').length;
  } else {
    parameterCount = 0;
  }
  BUILDIN_STYLE_NAMES.add(attribute);
  if (EXTEND_ATTRIBUTE.has(component)) {
    EXTEND_ATTRIBUTE.get(component).add({ attribute, parameterCount });
  } else {
    EXTEND_ATTRIBUTE.set(component, new Set([{ attribute, parameterCount }]));
  }
}

export function processSystemApi(content: string, isProcessWhiteList: boolean = false): string {
  let REG_SYSTEM: RegExp;
  REG_SYSTEM =
    /import\s+(.+)\s+from\s+['"]@(system|ohos)\.(\S+)['"]|import\s+(.+)\s*=\s*require\(\s*['"]@(system|ohos)\.(\S+)['"]\s*\)/g;
  const REG_LIB_SO: RegExp =
    /import\s+(.+)\s+from\s+['"]lib(\S+)\.so['"]|import\s+(.+)\s*=\s*require\(\s*['"]lib(\S+)\.so['"]\s*\)/g;
  return content.replace(REG_LIB_SO, (_, item1, item2, item3, item4) => {
    const libSoValue: string = item1 || item3;
    const libSoKey: string = item2 || item4;
    return `var ${libSoValue} = globalThis.requireNapi("${libSoKey}", true);`;
    }).replace(REG_SYSTEM, (item, item1, item2, item3, item4, item5, item6, item7) => {
      let moduleType: string = item2 || item5;
      let systemKey: string = item3 || item6;
      let systemValue: string = item1 || item4;
      moduleCollection.add(`${moduleType}.${systemKey}`);
      if (NATIVE_MODULE.has(`${moduleType}.${systemKey}`)) {
        item = `var ${systemValue} = globalThis.requireNativeModule('${moduleType}.${systemKey}')`;
      } else if (moduleType === SYSTEM_PLUGIN) {
        item = `var ${systemValue} = isSystemplugin('${systemKey}', '${SYSTEM_PLUGIN}') ? ` +
          `globalThis.systemplugin.${systemKey} : globalThis.requireNapi('${systemKey}')`;
      } else if (moduleType === OHOS_PLUGIN) {
        item = `var ${systemValue} = globalThis.requireNapi('${systemKey}') || ` +
          `(isSystemplugin('${systemKey}', '${OHOS_PLUGIN}') ? ` +
          `globalThis.ohosplugin.${systemKey} : isSystemplugin('${systemKey}', '${SYSTEM_PLUGIN}') ` +
          `? globalThis.systemplugin.${systemKey} : undefined)`;
      }
      return item;
    });
}

function validateWhiteListModule(moduleType: string, systemKey: string): boolean {
  return moduleType === 'ohos' && /^application\./g.test(systemKey);
}

export function resetComponentCollection() {
  componentCollection.entryComponent = null;
  componentCollection.previewComponent = null;
}
