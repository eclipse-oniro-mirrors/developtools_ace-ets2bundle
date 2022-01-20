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
    @BuilderParam child1: () => any;
    
    build() {
        Column() {
            this.child1()
            Text(this.header)
            Text(this.footer)
        }
    }
}

@Entry
@Component
struct CustomContainerUser {
    @Builder specificChild() {
        Column() {
            Text("My content1")
            Text("My content2")
        }
    }

    build() {
        Column() {
            CustomContainer({
                header: "Header",
                footer: "Footer",
            }){
                this.specificChild()
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
        this.__child1 = params.child1;
    }
    aboutToBeDeleted() {
        this.__child1.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id());
    }
    get child1() {
        return this.__child1.get();
    }
    set child1(newValue) {
        this.__child1.set(newValue);
    }
    render() {
        Column.create();
        Text.create(this.header);
        Text.pop();
        Text.create(this.footer);
        Text.pop();
        Column.pop();
    }
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
    specificChild() {
        Column.create();
        Text.create("My content1");
        Text.pop();
        Text.create("My content2");
        Text.pop();
        Column.pop();
    }
    render() {
        Column.create();
        let earlierCreatedChild_2 = this.findChildById("2");
        if (earlierCreatedChild_2 == undefined) {
            View.create(new CustomContainer("2", this, {
                header: "Header",
                footer: "Footer",
                child1: () => {
                    this.specificChild();
                }
            }));
        }
        else {
            earlierCreatedChild_2.updateWithValueParams({
                header: "Header",
                footer: "Footer",
                child1: () => {
                    this.specificChild();
                }
            });
            View.create(earlierCreatedChild_2);
        }
        Column.pop();
    }
}
loadDocument(new CustomContainerUser("1", undefined, {}));
`
