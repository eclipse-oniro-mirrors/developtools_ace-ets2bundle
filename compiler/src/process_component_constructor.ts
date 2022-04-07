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
  COMPONENT_CONSTRUCTOR_ID,
  COMPONENT_CONSTRUCTOR_PARENT,
  COMPONENT_CONSTRUCTOR_PARAMS,
  COMPONENT_CONSTRUCTOR_UPDATE_PARAMS,
  COMPONENT_WATCH_FUNCTION,
  BASE_COMPONENT_NAME,
  INTERFACE_NAME_SUFFIX
} from './pre_define';

export function getInitConstructor(members: ts.NodeArray<ts.Node>): ts.ConstructorDeclaration {
  let ctorNode: any = members.find(item => {
    return ts.isConstructorDeclaration(item);
  });
  if (ctorNode) {
    ctorNode = updateConstructor(ctorNode, [], [], true);
  }
  return initConstructorParams(ctorNode);
}

export function updateConstructor(ctorNode: ts.ConstructorDeclaration,
  para: ts.ParameterDeclaration[], addStatements: ts.Statement[], isSuper: boolean = false, isAdd: boolean = false, parentComponentName?: ts.Identifier):
  ts.ConstructorDeclaration {
  let modifyPara: ts.ParameterDeclaration[];
  if (para && para.length) {
    modifyPara = Array.from(ctorNode.parameters);
    if (modifyPara) {
      modifyPara.push(...para);
    }
  }
  let modifyBody: ts.Statement[];
  if (addStatements && addStatements.length && ctorNode) {
    modifyBody = Array.from(ctorNode.body.statements);
    if (modifyBody) {
      if (isSuper) {
        modifyBody.unshift(...addStatements);
      } else {
        modifyBody.push(...addStatements);
      }
    }
  }
  if (ctorNode) {
    let ctorPara: ts.ParameterDeclaration[] | ts.NodeArray<ts.ParameterDeclaration> =
      modifyPara || ctorNode.parameters;
    if (isAdd) {
      ctorPara = addParamsType(ctorNode, modifyPara, parentComponentName);
    }
    ctorNode = ts.factory.updateConstructorDeclaration(ctorNode, ctorNode.decorators,
      ctorNode.modifiers, ctorPara,
      ts.factory.createBlock(modifyBody || ctorNode.body.statements, true));
  }
  return ctorNode;
}

function initConstructorParams(node: ts.ConstructorDeclaration): ts.ConstructorDeclaration {
  const paramNames: string[] = [COMPONENT_CONSTRUCTOR_ID, COMPONENT_CONSTRUCTOR_PARENT,
    COMPONENT_CONSTRUCTOR_PARAMS];
  const newParameters: ts.ParameterDeclaration[] = Array.from(node.parameters);
  if (newParameters.length !== 0) {
    // @ts-ignore
    newParameters.splice(0, newParameters.length);
  }
  paramNames.forEach((paramName: string) => {
    // @ts-ignore
    newParameters.push(ts.factory.createParameterDeclaration(undefined, undefined, undefined,
      ts.factory.createIdentifier(paramName), undefined, undefined, undefined));
  });

  return ts.factory.updateConstructorDeclaration(node, undefined, node.modifiers, newParameters,
    node.body);
}

function addParamsType(ctorNode: ts.ConstructorDeclaration, modifyPara: ts.ParameterDeclaration[],
  parentComponentName: ts.Identifier): ts.ParameterDeclaration[] {
  const tsPara: ts.ParameterDeclaration[] | ts.NodeArray<ts.ParameterDeclaration> =
    modifyPara || ctorNode.parameters;
  const newTSPara: ts.ParameterDeclaration[] = [];
  tsPara.forEach((item) => {
    let parameter: ts.ParameterDeclaration = item;
    switch (item.name.escapedText) {
      case COMPONENT_CONSTRUCTOR_ID:
        parameter = ts.factory.updateParameterDeclaration(item, item.decorators, item.modifiers,
          item.dotDotDotToken, item.name, item.questionToken,
          ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword), item.initializer);
        break;
      case COMPONENT_CONSTRUCTOR_PARENT:
        parameter = ts.factory.createParameterDeclaration(item.decorators, item.modifiers,
          item.dotDotDotToken, item.name, item.questionToken,
          ts.factory.createTypeReferenceNode(ts.factory.createIdentifier(BASE_COMPONENT_NAME), undefined),
          item.initializer);
        break;
      case COMPONENT_CONSTRUCTOR_PARAMS:
        parameter = ts.factory.updateParameterDeclaration(item, item.decorators, item.modifiers,
          item.dotDotDotToken, item.name, item.questionToken,
          ts.factory.createTypeReferenceNode(ts.factory.createIdentifier(
            parentComponentName.getText() + INTERFACE_NAME_SUFFIX), undefined), item.initializer);
        break;
    }
    newTSPara.push(parameter);
  });
  return newTSPara;
}

export function addConstructor(ctorNode: any, watchMap: Map<string, ts.Node>,
  parentComponentName: ts.Identifier): ts.ConstructorDeclaration {
  const watchStatements: ts.ExpressionStatement[] = [];
  watchMap.forEach((value, key) => {
    const watchNode: ts.ExpressionStatement = ts.factory.createExpressionStatement(
      ts.factory.createCallExpression(
        ts.factory.createPropertyAccessExpression(
          ts.factory.createThis(),
          ts.factory.createIdentifier(COMPONENT_WATCH_FUNCTION)
        ),
        undefined,
        [
          ts.factory.createStringLiteral(key),
          ts.isStringLiteral(value) ?
            ts.factory.createPropertyAccessExpression(ts.factory.createThis(),
              ts.factory.createIdentifier(value.text)) : value as ts.PropertyAccessExpression
        ]
      ));
    watchStatements.push(watchNode);
  });
  const callSuperStatement: ts.Statement = ts.factory.createExpressionStatement(
    ts.factory.createCallExpression(ts.factory.createSuper(), undefined,
      [ts.factory.createIdentifier(COMPONENT_CONSTRUCTOR_ID),
        ts.factory.createIdentifier(COMPONENT_CONSTRUCTOR_PARENT)]));
  const updateWithValueParamsStatement: ts.Statement = ts.factory.createExpressionStatement(
    ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(
      ts.factory.createThis(), ts.factory.createIdentifier(COMPONENT_CONSTRUCTOR_UPDATE_PARAMS)),
    undefined, [ts.factory.createIdentifier(COMPONENT_CONSTRUCTOR_PARAMS)]));
  return updateConstructor(updateConstructor(ctorNode, [], [callSuperStatement], true), [],
    [updateWithValueParamsStatement, ...watchStatements], false, true, parentComponentName);
}
