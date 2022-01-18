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

@Builder function specificParam(label1: string, label2: string) {
    Column() {
        Text(label1)
        Text(label2)
    }
}

@Entry
@Component
struct CustomContainerUser {
    @Builder specificChild() {
        Column() {
            Text("My content1")
            Text("My content1")
        }
    }

    build() {
        Column() {
            CustomContainer({
                header: "Header",
                footer: "Footer",
                child: this.specificChild
            })
            CustomContainer({
                header: "Header",
                footer: "Footer",
                child: specificParam("content3", "content4")
            })
        }  
    }
}
`
exports.expectResult =
`class CustomContainer extends View {
    constructor(compilerAssignedUniqueChildId, parent, params) {
        super(compilerAssignedUniqueChildId, parent);
        this.header = ""
        this.footer = ""
        this.updateWithValueParams(params);
    }
    updateWithValueParams(params) {
        if (params.header !== undefined) {
            this.header = params.header;
        }
        if (params.footer !== undefined) {
            this.footer = params.footer;
        }
        this.__child = params.child;
    }
    aboutToBeDeleted() {
        this.__child.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id());
    }
    get child(){
        return this.__child.get();
    }
    set child(newValue) {
        this.__child.set(newValue)
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
function specificParam(label1, label2) {
    Column.create();
    Text.create(label1);
    Text.pop();
    Text.create(label1);
    Text.pop();
    Column.pop();
}
class CustomContainerUser {
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
                child: this.specificChild
            }));
        }
        else {
            earlierCreatedChild_2.updateWithValueParams({
                header: "Header",
                footer: "Footer",
                child: this.specificChild
            });
            View.create(earlierCreatedChild_2);
        }
        let earlierCreatedChild_3 = this.findChildById("3");
        if (earlierCreatedChild_3 == undefined) {
            View.create(new CustomContainer("3", this, {
                header: "Header",
                footer: "Footer",
                child: specificParam("content3", "content4")
            }));
        }
        else {
            earlierCreatedChild_3.updateWithValueParams({
                header: "Header",
                footer: "Footer",
                child: specificParam("content3", "content4")
            });
            View.create(earlierCreatedChild_3);
        }
        Column.pop(); 
    }
}
loadDocument(new MyComponent("1", undefined, {}));
`
