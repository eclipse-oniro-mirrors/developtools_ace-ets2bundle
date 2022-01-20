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

exports.source = `
@Component
struct CustomContainer {
    header: string = "";
    footer: string = "";
    @BuilderParam child: () => any;
    
    build() {
        Column() {
            Text(this.header)
            this.child()
            Text(this.footer)
        }
    }
}

@Builder function specificParam() {
    Column() {
        Text("label1")
        Text("label2")
    }
}

@Entry
@Component
struct CustomContainerUser {
    build() {
        Column() {
            CustomContainer({header: "Header", footer: "Footer"}){
                Column() {
                    Text("content1")
                        .width(50)
                    Text("content2")
                }
                specificParam()
            }
        }  
    }
}
`
exports.expectResult =
`class CustomContainer extends View {
    constructor(compilerAssignedUniqueChildId, parent, params) {
        super(compilerAssignedUniqueChildId, parent);
        this.header = "";
        this.footer = "";
        this.updateWithValueParams(params);
    }
    updateWithValueParams(params) {
        if (params.header !== undefined) {
            this.header = params.header;
        }
        if (params.footer !== undefined) {
            this.footer = params.footer;
        }
        this.child = params.child;
    }
    aboutToBeDeleted() {
        SubscriberManager.Get().delete(this.id());
    }
    render() {
        Column.create();
        Text.create(this.header);
        Text.pop();
        this.child();
        Text.create(this.footer);
        Text.pop();
        Column.pop();
    }
}
function specificParam() {
    Column.create();
    Text.create("label1");
    Text.pop();
    Text.create("label2");
    Text.pop();
    Column.pop();
}
class CustomContainerUser extends View {
    constructor(compilerAssignedUniqueChildId, parent, params) {
        super(compilerAssignedUniqueChildId, parent);
        this.updateWithValueParams(params);
    }
    updateWithValueParams(params) {
    }
    aboutToBeDeleted() {
        SubscriberManager.Get().delete(this.id());
    }
    render() {
        Column.create();
        let earlierCreatedChild_2 = this.findChildById("2");
        if (earlierCreatedChild_2 == undefined) {
            View.create(new CustomContainer("2", this, {
                header: "Header", footer: "Footer",
                child: () => {
                    Column.create();
                    Text.create("content1");
                    Text.width(50);
                    Text.pop();
                    Text.create("content2");
                    Text.pop();
                    Column.pop();
                    specificParam();
                }
            }));
        }
        else {
            earlierCreatedChild_2.updateWithValueParams({
                header: "Header", footer: "Footer",
                child: () => {
                    Column.create();
                    Text.create("content1");
                    Text.width(50);
                    Text.pop();
                    Text.create("content2");
                    Text.pop();
                    Column.pop();
                    specificParam();
                }
            });
            View.create(earlierCreatedChild_2);
        }
        Column.pop();
    }
}
loadDocument(new CustomContainerUser("1", undefined, {}));
`
