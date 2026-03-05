import {
  _decorator,
  Color,
  Component,
  EventMouse,
  EventTouch,
  Graphics,
  Input,
  Label,
  Node,
  UITransform,
  Vec2,
  input,
} from "cc";

const { ccclass } = _decorator;

type Player = 1 | 2;
type Group = "solid" | "stripe" | null;

interface Ball {
  id: number;
  pos: Vec2;
  vel: Vec2;
  inPocket: boolean;
  striped: boolean;
  isCue: boolean;
  isBlack: boolean;
  color: Color;
}

interface ShotRecord {
  firstHitBallId: number | null;
  pocketed: number[];
  cuePocketed: boolean;
  blackPocketed: boolean;
}

interface Layout {
  width: number;
  height: number;
  topReserve: number;
  bottomReserve: number;
  scale: number;
  tableW: number;
  tableH: number;
  rail: number;
  ballR: number;
  pocketR: number;
  tableCenterY: number;
}

@ccclass("ChineseEightBallGame")
export class ChineseEightBallGame extends Component {
  private readonly tableWidth = 1000;
  private readonly tableHeight = 560;
  private readonly railSize = 64;
  private readonly ballRadius = 13;
  private readonly pocketRadius = 35;
  private readonly friction = 45;
  private readonly maxShotSpeed = 1000;
  private readonly shotPowerScale = 5.0;
  private readonly maxAimDrag = 200;

  private readonly p1Name = "玩家1";
  private readonly p2Name = "玩家2";

  private graphics!: Graphics;
  private uiTransform!: UITransform;
  private topLeftLabel!: Label;
  private topRightLabel!: Label;
  private topCenterLabel!: Label;
  private statusLabel!: Label;

  private pockets: Vec2[] = [];
  private balls: Ball[] = [];
  private shotRecord: ShotRecord = {
    firstHitBallId: null,
    pocketed: [],
    cuePocketed: false,
    blackPocketed: false,
  };

  private currentPlayer: Player = 1;
  private playerGroups: Record<Player, Group> = { 1: null, 2: null };
  private aiming = false;
  private aimPointer = new Vec2();
  private shotInProgress = false;
  private gameOver = false;
  private placingCueBall = false;
  private lastMessage = "玩家1开球。拖拽并释放进行击球。";
  private currentPowerRatio = 0;
  private displayPowerRatio = 0;
  private elapsed = 0;
  private placementPreview = new Vec2();

  onLoad(): void {
    this.uiTransform = this.getComponent(UITransform) ?? this.addComponent(UITransform);
    this.graphics = this.getComponent(Graphics) ?? this.addComponent(Graphics);
    this.graphics.lineJoin = Graphics.LineJoin.ROUND;
    this.graphics.lineCap = Graphics.LineCap.ROUND;

    this.buildHud();
    this.buildTable();
    this.resetBalls();
    this.bindInput(true);
    this.layoutHud();
    this.refreshHud();
  }

  onDestroy(): void {
    this.bindInput(false);
  }

  update(dt: number): void {
    this.elapsed += dt;
    const targetPower = this.aiming ? this.currentPowerRatio : 0;
    this.displayPowerRatio += (targetPower - this.displayPowerRatio) * Math.min(1, dt * 12);

    if (this.shotInProgress && !this.gameOver) {
      this.stepPhysics(dt);
      if (this.areBallsStopped()) {
        this.shotInProgress = false;
        this.resolveShotEnd();
      }
    }

    this.layoutHud();
    this.drawScene();
    this.refreshHud();
  }

  private buildHud(): void {
    const topLeftNode = new Node("TopLeftLabel");
    topLeftNode.parent = this.node;
    topLeftNode.addComponent(UITransform).setContentSize(340, 40);
    const topLeft = topLeftNode.addComponent(Label);
    topLeft.fontSize = 22;
    topLeft.lineHeight = 28;
    topLeft.color = new Color(230, 239, 246, 255);
    topLeft.overflow = Label.Overflow.SHRINK;
    topLeft.horizontalAlign = Label.HorizontalAlign.CENTER;
    topLeft.verticalAlign = Label.VerticalAlign.CENTER;
    this.topLeftLabel = topLeft;

    const topRightNode = new Node("TopRightLabel");
    topRightNode.parent = this.node;
    topRightNode.addComponent(UITransform).setContentSize(340, 40);
    const topRight = topRightNode.addComponent(Label);
    topRight.fontSize = 22;
    topRight.lineHeight = 28;
    topRight.color = new Color(230, 239, 246, 255);
    topRight.overflow = Label.Overflow.SHRINK;
    topRight.horizontalAlign = Label.HorizontalAlign.CENTER;
    topRight.verticalAlign = Label.VerticalAlign.CENTER;
    this.topRightLabel = topRight;

    const topCenterNode = new Node("TopCenterLabel");
    topCenterNode.parent = this.node;
    topCenterNode.addComponent(UITransform).setContentSize(180, 34);
    const topCenter = topCenterNode.addComponent(Label);
    topCenter.fontSize = 18;
    topCenter.lineHeight = 24;
    topCenter.color = new Color(246, 233, 190, 255);
    topCenter.overflow = Label.Overflow.SHRINK;
    topCenter.horizontalAlign = Label.HorizontalAlign.CENTER;
    topCenter.verticalAlign = Label.VerticalAlign.CENTER;
    this.topCenterLabel = topCenter;

    const statusNode = new Node("StatusLabel");
    statusNode.parent = this.node;
    statusNode.addComponent(UITransform).setContentSize(1200, 70);
    const status = statusNode.addComponent(Label);
    status.fontSize = 20;
    status.lineHeight = 28;
    status.color = new Color(240, 237, 231, 255);
    status.overflow = Label.Overflow.SHRINK;
    status.horizontalAlign = Label.HorizontalAlign.CENTER;
    status.verticalAlign = Label.VerticalAlign.CENTER;
    this.statusLabel = status;
  }

  private layoutHud(): void {
    const size = this.uiTransform.contentSize;
    const topReserve = this.getTopReserve();
    const bottomReserve = this.getBottomReserve();

    const topY = size.height * 0.5 - topReserve * 0.38;
    this.topLeftLabel.node.setPosition(-size.width * 0.25, topY, 0);
    this.topRightLabel.node.setPosition(size.width * 0.25, topY, 0);
    this.topCenterLabel.node.setPosition(0, topY - 20, 0);
    this.statusLabel.node.setPosition(0, -size.height * 0.5 + bottomReserve * 0.46, 0);

    const statusTransform = this.statusLabel.getComponent(UITransform);
    if (statusTransform) {
      statusTransform.setContentSize(size.width - 100, Math.max(64, bottomReserve - 24));
    }
  }

  private buildTable(): void {
    const hw = this.tableWidth * 0.5;
    const hh = this.tableHeight * 0.5;
    this.pockets = [
      new Vec2(-hw, -hh),
      new Vec2(0, -hh),
      new Vec2(hw, -hh),
      new Vec2(-hw, hh),
      new Vec2(0, hh),
      new Vec2(hw, hh),
    ];
  }

  private resetBalls(): void {
    this.balls = [];
    this.playerGroups = { 1: null, 2: null };
    this.currentPlayer = 1;
    this.aiming = false;
    this.shotInProgress = false;
    this.gameOver = false;
    this.placingCueBall = false;
    this.currentPowerRatio = 0;
    this.displayPowerRatio = 0;
    this.resetShotRecord();

    this.balls.push({
      id: 0,
      pos: new Vec2(-this.tableWidth * 0.25, 0),
      vel: new Vec2(),
      inPocket: false,
      striped: false,
      isCue: true,
      isBlack: false,
      color: new Color(248, 247, 241, 255),
    });

    const rackNumbers = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
    const spacingX = this.ballRadius * 2.08;
    const spacingY = this.ballRadius * 2.2;
    const apexX = this.tableWidth * 0.23;
    let idx = 0;
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col <= row; col++) {
        const id = rackNumbers[idx++];
        this.balls.push({
          id,
          pos: new Vec2(apexX + row * spacingX, (col - row * 0.5) * spacingY),
          vel: new Vec2(),
          inPocket: false,
          striped: id >= 9,
          isCue: false,
          isBlack: id === 8,
          color: this.getBallColor(id),
        });
      }
    }
  }

  private bindInput(bind: boolean): void {
    if (bind) {
      input.on(Input.EventType.MOUSE_DOWN, this.onPointerDown, this);
      input.on(Input.EventType.MOUSE_MOVE, this.onPointerMove, this);
      input.on(Input.EventType.MOUSE_UP, this.onPointerUp, this);
      input.on(Input.EventType.TOUCH_START, this.onPointerDown, this);
      input.on(Input.EventType.TOUCH_MOVE, this.onPointerMove, this);
      input.on(Input.EventType.TOUCH_END, this.onPointerUp, this);
      input.on(Input.EventType.TOUCH_CANCEL, this.onPointerUp, this);
      return;
    }

    input.off(Input.EventType.MOUSE_DOWN, this.onPointerDown, this);
    input.off(Input.EventType.MOUSE_MOVE, this.onPointerMove, this);
    input.off(Input.EventType.MOUSE_UP, this.onPointerUp, this);
    input.off(Input.EventType.TOUCH_START, this.onPointerDown, this);
    input.off(Input.EventType.TOUCH_MOVE, this.onPointerMove, this);
    input.off(Input.EventType.TOUCH_END, this.onPointerUp, this);
    input.off(Input.EventType.TOUCH_CANCEL, this.onPointerUp, this);
  }

  private onPointerDown(event: EventMouse | EventTouch): void {
    if (event instanceof EventMouse && event.getButton() !== EventMouse.BUTTON_LEFT) {
      return;
    }

    if (this.gameOver) {
      this.restartGame();
      return;
    }
    if (this.shotInProgress) {
      return;
    }

    const pointer = this.uiToTable(event);
    if (this.placingCueBall) {
      if (this.isInsideTable(pointer, -8)) {
        this.placeCueBall(pointer);
      }
      return;
    }

    if (!this.isInsideTable(pointer, -6)) {
      return;
    }

    const cue = this.getCueBall();
    if (cue.inPocket) {
      this.lastMessage = "母球出界。请先放置母球。";
      return;
    }

    this.aiming = true;
    this.aimPointer.set(pointer.x, pointer.y);
    this.currentPowerRatio = 0;
  }

  private onPointerMove(event: EventMouse | EventTouch): void {
    if (!this.aiming || this.gameOver || this.shotInProgress || this.placingCueBall) {
      if (this.placingCueBall) {
        const pointer = this.uiToTable(event);
        this.placementPreview.set(pointer.x, pointer.y);
      }
      return;
    }
    const pointer = this.uiToTable(event);
    this.aimPointer.set(pointer.x, pointer.y);
    this.currentPowerRatio = this.computePowerRatio(pointer);
  }

  private onPointerUp(event: EventMouse | EventTouch): void {
    if (!this.aiming || this.gameOver || this.shotInProgress || this.placingCueBall) {
      return;
    }
    const pointer = this.uiToTable(event);
    this.aimPointer.set(pointer.x, pointer.y);
    this.currentPowerRatio = this.computePowerRatio(pointer);
    this.tryShoot();
  }

  private computePowerRatio(pointer: Vec2): number {
    const drag = Vec2.distance(this.getCueBall().pos, pointer);
    return this.clamp(drag / this.maxAimDrag, 0, 1);
  }

  private tryShoot(): void {
    const cue = this.getCueBall();
    const dx = cue.pos.x - this.aimPointer.x;
    const dy = cue.pos.y - this.aimPointer.y;
    const drag = Math.sqrt(dx * dx + dy * dy);
    this.aiming = false;
    if (drag < 6) {
      this.currentPowerRatio = 0;
      return;
    }

    const power = Math.min(drag * this.shotPowerScale, this.maxShotSpeed);
    cue.vel.set((dx / drag) * power, (dy / drag) * power);
    this.currentPowerRatio = 0;
    this.shotInProgress = true;
    this.resetShotRecord();
  }

  private placeCueBall(point: Vec2): void {
    if (!this.isValidCuePlacement(point)) {
      this.lastMessage = "无效的母球放置：与其他球重叠或离球洞太近。";
      return;
    }

    const cue = this.getCueBall();
    cue.inPocket = false;
    cue.vel.set(0, 0);
    cue.pos.set(point.x, point.y);
    this.placingCueBall = false;
    this.lastMessage = `${this.playerName(this.currentPlayer)} 放置了母球。现在可以击球。`;
  }

  private isValidCuePlacement(point: Vec2): boolean {
    const hw = this.tableWidth * 0.5 - this.ballRadius - 2;
    const hh = this.tableHeight * 0.5 - this.ballRadius - 2;
    if (point.x < -hw || point.x > hw || point.y < -hh || point.y > hh) {
      return false;
    }

    for (const pocket of this.pockets) {
      if (Vec2.distance(point, pocket) < this.pocketRadius + this.ballRadius * 0.4) {
        return false;
      }
    }

    const minDist = this.ballRadius * 2 + 0.8;
    for (const ball of this.balls) {
      if (ball.isCue || ball.inPocket) {
        continue;
      }
      if (Vec2.distance(point, ball.pos) < minDist) {
        return false;
      }
    }
    return true;
  }

  private stepPhysics(dt: number): void {
    const subStep = 1 / 120;
    const steps = Math.max(1, Math.ceil(dt / subStep));
    const stepDt = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.integrate(stepDt);
      this.resolveBallCollisions();
      this.resolveRailCollisions();
      this.detectPockets();
    }
  }

  private integrate(dt: number): void {
    for (const ball of this.balls) {
      if (ball.inPocket) {
        continue;
      }

      ball.pos.x += ball.vel.x * dt;
      ball.pos.y += ball.vel.y * dt;

      const speed = ball.vel.length();
      if (speed <= 0.0001) {
        ball.vel.set(0, 0);
        continue;
      }

      const nextSpeed = Math.max(0, speed - this.friction * dt);
      if (nextSpeed === 0) {
        ball.vel.set(0, 0);
      } else {
        ball.vel.multiplyScalar(nextSpeed / speed);
      }
    }
  }

  private resolveBallCollisions(): void {
    const minDist = this.ballRadius * 2;
    const restitution = 0.97;
    for (let i = 0; i < this.balls.length; i++) {
      const a = this.balls[i];
      if (a.inPocket) {
        continue;
      }
      for (let j = i + 1; j < this.balls.length; j++) {
        const b = this.balls[j];
        if (b.inPocket) {
          continue;
        }

        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const distSq = dx * dx + dy * dy;
        if (distSq >= minDist * minDist || distSq <= 1e-10) {
          continue;
        }

        const dist = Math.sqrt(distSq);
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = minDist - dist;

        a.pos.x -= nx * overlap * 0.5;
        a.pos.y -= ny * overlap * 0.5;
        b.pos.x += nx * overlap * 0.5;
        b.pos.y += ny * overlap * 0.5;

        const relVx = b.vel.x - a.vel.x;
        const relVy = b.vel.y - a.vel.y;
        const vn = relVx * nx + relVy * ny;
        if (vn >= 0) {
          continue;
        }

        const impulse = -vn * restitution;
        a.vel.x -= impulse * nx;
        a.vel.y -= impulse * ny;
        b.vel.x += impulse * nx;
        b.vel.y += impulse * ny;

        if (this.shotRecord.firstHitBallId === null) {
          if (a.isCue && !b.isCue) {
            this.shotRecord.firstHitBallId = b.id;
          } else if (b.isCue && !a.isCue) {
            this.shotRecord.firstHitBallId = a.id;
          }
        }
      }
    }
  }

  private resolveRailCollisions(): void {
    const hw = this.tableWidth * 0.5;
    const hh = this.tableHeight * 0.5;
    const restitution = 0.86;
    for (const ball of this.balls) {
      if (ball.inPocket) {
        continue;
      }

      const left = -hw + this.ballRadius;
      const right = hw - this.ballRadius;
      const bottom = -hh + this.ballRadius;
      const top = hh - this.ballRadius;

      if (ball.pos.x < left) {
        if (!(Math.abs(ball.pos.y) > hh - this.pocketRadius * 1.2)) {
          ball.pos.x = left;
          ball.vel.x = Math.abs(ball.vel.x) * restitution;
        }
      } else if (ball.pos.x > right) {
        if (!(Math.abs(ball.pos.y) > hh - this.pocketRadius * 1.2)) {
          ball.pos.x = right;
          ball.vel.x = -Math.abs(ball.vel.x) * restitution;
        }
      }

      if (ball.pos.y < bottom) {
        const atMidGate = Math.abs(ball.pos.x) < this.pocketRadius * 1.3;
        const atCornerGate = Math.abs(ball.pos.x) > hw - this.pocketRadius * 1.2;
        if (!atMidGate && !atCornerGate) {
          ball.pos.y = bottom;
          ball.vel.y = Math.abs(ball.vel.y) * restitution;
        }
      } else if (ball.pos.y > top) {
        const atMidGate = Math.abs(ball.pos.x) < this.pocketRadius * 1.3;
        const atCornerGate = Math.abs(ball.pos.x) > hw - this.pocketRadius * 1.2;
        if (!atMidGate && !atCornerGate) {
          ball.pos.y = top;
          ball.vel.y = -Math.abs(ball.vel.y) * restitution;
        }
      }
    }
  }

  private detectPockets(): void {
    for (const ball of this.balls) {
      if (ball.inPocket) {
        continue;
      }
      for (const pocket of this.pockets) {
        if (Vec2.distance(ball.pos, pocket) <= this.pocketRadius) {
          this.pocketBall(ball);
          break;
        }
      }
    }
  }

  private pocketBall(ball: Ball): void {
    ball.inPocket = true;
    ball.vel.set(0, 0);
    if (ball.isCue) {
      this.shotRecord.cuePocketed = true;
      return;
    }
    this.shotRecord.pocketed.push(ball.id);
    if (ball.isBlack) {
      this.shotRecord.blackPocketed = true;
    }
  }

  private resolveShotEnd(): void {
    if (this.gameOver) {
      return;
    }

    const opponent = this.otherPlayer(this.currentPlayer);
    let foulReason = "";

    if (this.shotRecord.firstHitBallId === null) {
      foulReason = "没有合法的首次接触。";
    } else {
      const legalTargets = this.getLegalTargets(this.currentPlayer);
      if (!legalTargets.includes(this.shotRecord.firstHitBallId)) {
        foulReason = `首次撞击错误 (${this.describeBall(this.shotRecord.firstHitBallId)})。`;
      }
    }

    if (!foulReason && this.shotRecord.cuePocketed) {
      foulReason = "母球入袋犯规。";
    }

    if (this.shotRecord.blackPocketed) {
      const legalBlack = this.canHitBlack(this.currentPlayer);
      if (foulReason || !legalBlack) {
        this.finishGame(opponent, `非法8号球入袋。${this.playerName(opponent)} 获胜。`);
      } else {
        this.finishGame(this.currentPlayer, `${this.playerName(this.currentPlayer)} 清台获胜。`);
      }
      return;
    }

    if (!foulReason && this.playerGroups[1] === null) {
      this.assignGroupsFromPocketed();
    }

    if (foulReason) {
      this.currentPlayer = opponent;
      this.startBallInHand(`${foulReason} ${this.playerName(this.currentPlayer)} 获得自由球。`);
      return;
    }

    const pocketedOwn = this.countPocketedOwn(this.currentPlayer);
    const openTableContinue =
      this.playerGroups[this.currentPlayer] === null &&
      this.shotRecord.pocketed.some((id) => this.ballGroup(id) !== null);

    if (pocketedOwn > 0 || openTableContinue) {
      this.lastMessage = `${this.playerName(this.currentPlayer)} 继续。`;
    } else {
      this.currentPlayer = opponent;
      this.lastMessage = `没有合法进球。轮到 ${this.playerName(this.currentPlayer)}。`;
    }
  }

  private assignGroupsFromPocketed(): void {
    const firstObject = this.shotRecord.pocketed.find((id) => this.ballGroup(id) !== null);
    if (firstObject === undefined) {
      return;
    }

    const firstGroup = this.ballGroup(firstObject);
    if (firstGroup === null) {
      return;
    }

    const opponent = this.otherPlayer(this.currentPlayer);
    this.playerGroups[this.currentPlayer] = firstGroup;
    this.playerGroups[opponent] = firstGroup === "solid" ? "stripe" : "solid";
    this.lastMessage =
      `${this.playerName(this.currentPlayer)} 选择 ${this.groupName(firstGroup)}。 ` +
      `${this.playerName(opponent)} 获得 ${this.groupName(this.playerGroups[opponent])}。`;
  }

  private startBallInHand(message: string): void {
    this.placingCueBall = true;
    this.lastMessage = message;
    const cue = this.getCueBall();
    cue.inPocket = false;
    cue.vel.set(0, 0);
    cue.pos.set(-this.tableWidth * 0.25, 0);
  }

  private finishGame(winner: Player, message: string): void {
    this.gameOver = true;
    this.aiming = false;
    this.shotInProgress = false;
    this.placingCueBall = false;
    this.currentPlayer = winner;
    this.lastMessage = `${message} 点击任意位置重新开始。`;
  }

  private getLegalTargets(player: Player): number[] {
    const group = this.playerGroups[player];
    if (group === null) {
      return this.balls
        .filter((b) => !b.inPocket && !b.isCue && !b.isBlack)
        .map((b) => b.id);
    }
    if (this.countRemainingOfGroup(group) > 0) {
      return this.balls
        .filter((b) => !b.inPocket && this.ballGroup(b.id) === group)
        .map((b) => b.id);
    }

    const black = this.balls.find((b) => b.id === 8);
    return black && !black.inPocket ? [8] : [];
  }

  private countPocketedOwn(player: Player): number {
    const group = this.playerGroups[player];
    if (group === null) {
      return 0;
    }
    return this.shotRecord.pocketed.filter((id) => this.ballGroup(id) === group).length;
  }

  private countRemainingOfGroup(group: Group): number {
    if (group === null) {
      return 0;
    }
    return this.balls.filter((b) => !b.inPocket && this.ballGroup(b.id) === group).length;
  }

  private canHitBlack(player: Player): boolean {
    const group = this.playerGroups[player];
    if (group === null) {
      return false;
    }
    return this.countRemainingOfGroup(group) === 0;
  }

  private areBallsStopped(): boolean {
    for (const ball of this.balls) {
      if (ball.inPocket) {
        continue;
      }
      if (ball.vel.lengthSqr() > 16) {
        return false;
      }
    }
    return true;
  }

  private drawScene(): void {
    const g = this.graphics;
    g.clear();
    const layout = this.getLayout();

    this.drawBackground(layout);
    this.drawTopHud(layout);
    this.drawTable(layout);
    this.drawRailLights(layout);
    this.drawBalls(layout);
    this.drawAimGuide(layout);
    this.drawCueStick(layout);
    this.drawLeftPowerMeter(layout);
    this.drawPlacementPreview(layout);
    if (this.gameOver) {
      this.drawGameOverOverlay(layout);
    }
  }

  private getLayout(): Layout {
    const size = this.uiTransform.contentSize;
    const scale = Math.min(size.width / (this.tableWidth + this.railSize * 2), size.height / (this.tableHeight + this.railSize * 2));
    const topReserve = size.height * 0.15;
    const bottomReserve = size.height * 0.12;
    return {
      width: size.width,
      height: size.height,
      topReserve,
      bottomReserve,
      scale,
      tableW: this.tableWidth * scale,
      tableH: this.tableHeight * scale,
      rail: this.railSize * scale,
      ballR: this.ballRadius * scale,
      pocketR: this.pocketRadius * scale,
      tableCenterY: 0,
    };
  }

  private drawBackground(layout: Layout): void {
    const g = this.graphics;
    const hw = layout.width * 0.5;
    const hh = layout.height * 0.5;
    g.fillColor = new Color(26, 28, 30, 255);
    g.rect(-hw, -hh, layout.width, layout.height);
    g.fill();
  }

  private drawTopHud(layout: Layout): void {
    const g = this.graphics;
    const topY = layout.height * 0.5 - layout.topReserve * 0.38;
    g.fillColor = new Color(40, 44, 52, 180);
    g.rect(-layout.width * 0.4, topY - 20, layout.width * 0.8, 40);
    g.fill();
  }

  private drawTable(layout: Layout): void {
    const g = this.graphics;
    const hw = layout.tableW * 0.5;
    const hh = layout.tableH * 0.5;
    const tableY = layout.tableCenterY;
    g.fillColor = new Color(34, 139, 34, 255);
    g.rect(-hw, tableY - hh, layout.tableW, layout.tableH);
    g.fill();
    g.strokeColor = new Color(139, 69, 19, 255);
    g.lineWidth = layout.rail;
    g.rect(-hw - layout.rail * 0.5, tableY - hh - layout.rail * 0.5, layout.tableW + layout.rail, layout.tableH + layout.rail);
    g.stroke();
  }

  private drawRailLights(layout: Layout): void {
    const g = this.graphics;
    const hw = layout.tableW * 0.5;
    const hh = layout.tableH * 0.5;
    const tableY = layout.tableCenterY;
    const lightR = layout.pocketR * 0.3;
    g.fillColor = new Color(255, 215, 0, 255);
    for (const pocket of this.pockets) {
      const px = pocket.x * layout.scale;
      const py = tableY + pocket.y * layout.scale;
      g.circle(px, py, lightR);
      g.fill();
    }
  }

  private drawBalls(layout: Layout): void {
    const g = this.graphics;
    const tableY = layout.tableCenterY;
    for (const ball of this.balls) {
      if (ball.inPocket) {
        continue;
      }
      const bx = ball.pos.x * layout.scale;
      const by = tableY + ball.pos.y * layout.scale;
      g.fillColor = ball.color;
      g.circle(bx, by, layout.ballR);
      g.fill();
      if (ball.striped) {
        g.fillColor = new Color(248, 247, 241, 255);
        g.circle(bx, by, layout.ballR * 0.5);
        g.fill();
      }
    }
  }

  private drawAimGuide(layout: Layout): void {
    if (!this.aiming || this.shotInProgress) {
      return;
    }
    const g = this.graphics;
    const tableY = layout.tableCenterY;
    const cue = this.getCueBall();
    if (cue.inPocket) {
      return;
    }
    const cx = cue.pos.x * layout.scale;
    const cy = tableY + cue.pos.y * layout.scale;
    const px = this.aimPointer.x * layout.scale;
    const py = tableY + this.aimPointer.y * layout.scale;
    const dx = cx - px;
    const dy = cy - py;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 6 * layout.scale) {
      return;
    }
    g.strokeColor = new Color(255, 255, 255, 100);
    g.lineWidth = 2;
    g.moveTo(cx, cy);
    g.lineTo(cx + dx * 2, cy + dy * 2);
    g.stroke();
  }

  private drawCueStick(layout: Layout): void {
    if (!this.aiming || this.shotInProgress) {
      return;
    }
    const g = this.graphics;
    const tableY = layout.tableCenterY;
    const cue = this.getCueBall();
    if (cue.inPocket) {
      return;
    }
    const cx = cue.pos.x * layout.scale;
    const cy = tableY + cue.pos.y * layout.scale;
    const px = this.aimPointer.x * layout.scale;
    const py = tableY + this.aimPointer.y * layout.scale;
    const dx = cx - px;
    const dy = cy - py;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 6 * layout.scale) {
      return;
    }
    const nx = dx / dist;
    const ny = dy / dist;
    const offset = layout.ballR + 10 + this.displayPowerRatio * 50;
    const stickLen = 200;
    const stickX = cx + nx * offset;
    const stickY = cy + ny * offset;
    g.strokeColor = new Color(139, 69, 19, 255);
    g.lineWidth = 6;
    g.moveTo(stickX, stickY);
    g.lineTo(stickX + nx * stickLen, stickY + ny * stickLen);
    g.stroke();
  }

  private drawLeftPowerMeter(layout: Layout): void {
    if (!this.aiming) {
      return;
    }
    const g = this.graphics;
    const meterW = 20;
    const meterH = 150;
    const meterX = -layout.width * 0.5 + 30;
    const meterY = 0;
    g.fillColor = new Color(50, 50, 50, 200);
    g.rect(meterX - meterW * 0.5, meterY - meterH * 0.5, meterW, meterH);
    g.fill();
    const powerH = this.displayPowerRatio * meterH;
    const r = Math.floor(this.displayPowerRatio * 255);
    const gColor = Math.floor((1 - this.displayPowerRatio) * 255);
    g.fillColor = new Color(r, gColor, 0, 255);
    g.rect(meterX - meterW * 0.5, meterY - meterH * 0.5, meterW, powerH);
    g.fill();
  }

  private drawGameOverOverlay(layout: Layout): void {
    const g = this.graphics;
    g.fillColor = new Color(0, 0, 0, 180);
    g.rect(-layout.width * 0.5, -layout.height * 0.5, layout.width, layout.height);
    g.fill();
  }

  private drawPlacementPreview(layout: Layout): void {
    if (!this.placingCueBall) {
      return;
    }
    const g = this.graphics;
    const tableY = layout.tableCenterY;
    const bx = this.placementPreview.x * layout.scale;
    const by = tableY + this.placementPreview.y * layout.scale;
    const valid = this.isValidCuePlacement(this.placementPreview);
    g.fillColor = valid ? new Color(0, 255, 0, 100) : new Color(255, 0, 0, 100);
    g.circle(bx, by, layout.ballR);
    g.fill();
    g.strokeColor = valid ? new Color(0, 255, 0, 200) : new Color(255, 0, 0, 200);
    g.lineWidth = 2;
    g.circle(bx, by, layout.ballR);
    g.stroke();
  }

  private uiToTable(event: EventMouse | EventTouch): Vec2 {
    const layout = this.getLayout();
    const uiPos = event.getUILocation();
    const size = this.uiTransform.contentSize;
    const x = (uiPos.x - size.width * 0.5) / layout.scale;
    const y = (uiPos.y - size.height * 0.5 - layout.tableCenterY) / layout.scale;
    return new Vec2(x, y);
  }

  private isInsideTable(point: Vec2, margin: number): boolean {
    const hw = this.tableWidth * 0.5 + margin;
    const hh = this.tableHeight * 0.5 + margin;
    return point.x >= -hw && point.x <= hw && point.y >= -hh && point.y <= hh;
  }

  private getCueBall(): Ball {
    return this.balls[0];
  }

  private resetShotRecord(): void {
    this.shotRecord = {
      firstHitBallId: null,
      pocketed: [],
      cuePocketed: false,
      blackPocketed: false,
    };
  }

  private otherPlayer(player: Player): Player {
    return player === 1 ? 2 : 1;
  }

  private describeBall(id: number): string {
    if (id === 0) {
      return "母球";
    }
    if (id === 8) {
      return "8号球";
    }
    return `球 ${id}`;
  }

  private ballGroup(id: number): Group {
    if (id === 0 || id === 8) {
      return null;
    }
    return id >= 9 ? "stripe" : "solid";
  }

  private groupName(group: Group): string {
    if (group === null) {
      return "无";
    }
    return group === "solid" ? "实球" : "花球";
  }

  private playerName(player: Player): string {
    return player === 1 ? this.p1Name : this.p2Name;
  }

  private getTopReserve(): number {
    return this.uiTransform.contentSize.height * 0.15;
  }

  private getBottomReserve(): number {
    return this.uiTransform.contentSize.height * 0.12;
  }

  private getBallColor(id: number): Color {
    const colors: Record<number, Color> = {
      1: new Color(255, 215, 0, 255),
      2: new Color(0, 0, 255, 255),
      3: new Color(255, 0, 0, 255),
      4: new Color(128, 0, 128, 255),
      5: new Color(255, 165, 0, 255),
      6: new Color(0, 128, 0, 255),
      7: new Color(128, 0, 0, 255),
      8: new Color(0, 0, 0, 255),
      9: new Color(255, 215, 0, 255),
      10: new Color(0, 0, 255, 255),
      11: new Color(255, 0, 0, 255),
      12: new Color(128, 0, 128, 255),
      13: new Color(255, 165, 0, 255),
      14: new Color(0, 128, 0, 255),
      15: new Color(128, 0, 0, 255),
    };
    return colors[id] || new Color(255, 255, 255, 255);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private restartGame(): void {
    this.resetBalls();
    this.lastMessage = "玩家1开球。拖拽并释放进行击球。";
  }

  private refreshHud(): void {
    this.topLeftLabel.string = `${this.playerName(1)}: ${this.groupName(this.playerGroups[1])}`;
    this.topRightLabel.string = `${this.playerName(2)}: ${this.groupName(this.playerGroups[2])}`;
    this.topCenterLabel.string = this.currentPlayer === 1 ? "▲" : "▼";
    this.statusLabel.string = this.lastMessage;
  }
}
