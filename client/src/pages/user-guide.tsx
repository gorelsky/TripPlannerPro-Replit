import { BookOpen, CheckCircle2, ExternalLink, MessageCircle, Plane, UserRound } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/auth-context";

const trivioUrl = "https://login.trivio.ru/?toUrl=/desktop/info";

function StepList({ items }: { items: string[] }) {
  return (
    <ol className="space-y-2 text-sm leading-6 text-muted-foreground">
      {items.map((item, index) => (
        <li key={item} className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {index + 1}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}

export default function UserGuide() {
  const { user } = useAuth();
  const canViewRegistryGuide = user?.role === "admin" || user?.role === "coordinator";
  const canViewAnalyticsGuide = ["admin", "coordinator", "accountant", "ceo", "deputy_ceo"].includes(user?.role || "");

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 sm:space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <BookOpen className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-semibold sm:text-2xl">Инструкция</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Работа с системой планирования и согласования командировок
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="border-l-4 border-primary bg-muted/30 px-4 py-3">
          <p className="text-sm font-medium">Создайте заявку</p>
          <p className="mt-1 text-xs text-muted-foreground">Маршрут, транспорт, даты и цель</p>
        </div>
        <div className="border-l-4 border-amber-500 bg-muted/30 px-4 py-3">
          <p className="text-sm font-medium">Направьте на согласование</p>
          <p className="mt-1 text-xs text-muted-foreground">Заявка уйдет назначенному руководителю</p>
        </div>
        <div className="border-l-4 border-emerald-600 bg-muted/30 px-4 py-3">
          <p className="text-sm font-medium">Следите за статусом</p>
          <p className="mt-1 text-xs text-muted-foreground">История доступна в «Моих командировках»</p>
        </div>
      </div>

      <Accordion type="multiple" defaultValue={["start", "trip", "chat"]} className="w-full border-y">
        <AccordionItem value="start">
          <AccordionTrigger className="text-left text-base">Начало работы</AccordionTrigger>
          <AccordionContent>
            <StepList items={[
              "Откройте приложение и войдите с рабочим email и паролем, выданным администратором.",
              "Перейдите в «Мой профиль» и проверьте ФИО, отдел и руководителя.",
              "Если организационные данные указаны неверно, направьте обращение через «Мой профиль» -> «Связь с администратором».",
            ]} />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="password">
          <AccordionTrigger className="text-left text-base">Смена и восстановление пароля</AccordionTrigger>
          <AccordionContent className="space-y-4">
            <div className="space-y-2 text-sm leading-6 text-muted-foreground">
              <p>Чтобы сменить известный пароль, откройте «Мой профиль» → «Пароль», введите текущий пароль, новый пароль и его подтверждение, затем нажмите «Изменить пароль».</p>
              <p>Если пароль забыт, на странице входа нажмите «Забыли пароль?». Откроется новое письмо в почтовом клиенте с адресатом <strong>admin.tripplanner@sls-pharma.ru</strong> и автоматически добавленной корпоративной подписью.</p>
              <p>Администратор сформирует временный пароль только для вашей учётной записи и отправит его на рабочую почту. После входа сразу смените временный пароль в «Моём профиле».</p>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="roles">
          <AccordionTrigger className="text-left text-base">Роли и доступ к данным</AccordionTrigger>
          <AccordionContent className="space-y-2 text-sm leading-6 text-muted-foreground">
            <p>Сотрудник видит только свои командировки. Руководитель видит свои поездки и поездки подчиненных в пределах своей структуры.</p>
            <p>Генеральный директор, заместители генерального директора и администратор видят все командировки.</p>
            <p>Координатор видит все поездки в дашборде и календаре, работает со справочниками, но не согласовывает командировки и не меняет суточные или рассылку.</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="trip">
          <AccordionTrigger className="text-left text-base">Создание командировки</AccordionTrigger>
          <AccordionContent className="space-y-4">
            <StepList items={[
              "Откройте «Мои командировки» и нажмите «Создать командировку».",
              "Выберите маршрут из списка, вид транспорта, даты и укажите цель поездки.",
              "При необходимости перейдите в Trivio, чтобы подобрать Ж/Д или авиабилеты и проживание.",
              "Вернитесь в заявку и добавьте номер бронирования и ссылку Trivio, если они уже есть.",
              "Выберите тип: «Плановая» или «Внеплановая». Для внеплановой поездки укажите обоснование; при переносе выберите исходную командировку и причину переноса.",
              "Выберите «Сохранить черновик» либо «Отправить на согласование».",
            ]} />
            <div className="flex flex-wrap items-center gap-2 border-t pt-4 text-sm text-muted-foreground">
              <Plane className="h-4 w-4 text-primary" />
              <span>Субботы, воскресенья и праздники выделены розовым. Поездку на такую дату нужно подтвердить.</span>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="memos">
          <AccordionTrigger className="text-left text-base">Черновики и служебные записки</AccordionTrigger>
          <AccordionContent className="space-y-3 text-sm leading-6 text-muted-foreground">
            <p>Черновик можно открыть кнопкой «Редактировать», исправить маршрут, даты, цель, тип поездки и данные Trivio, а затем снова сохранить или отправить на согласование.</p>
            <p>Для новой внеплановой командировки в меню «СЗ» доступна служебная записка на внеплановую поездку. ФИО, маршрут и даты подставляются автоматически.</p>
            <p>Перенос оформляется созданием новой внеплановой поездки с выбором исходной. Для новой записи доступна СЗ на перенос, а исходная командировка получает статус переноса.</p>
            <p>Для уже созданной поездки через «Действия» можно сформировать СЗ на отмену или изменение условий. Укажите требуемые причины и изменения в открывшейся форме.</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="status">
          <AccordionTrigger className="text-left text-base">Статусы и согласование</AccordionTrigger>
          <AccordionContent className="space-y-3 text-sm text-muted-foreground">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">Черновик</Badge><span>заявка сохранена, но еще не отправлена;</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-amber-500 hover:bg-amber-500">На согласовании</Badge><span>ожидается решение следующего руководителя;</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-blue-600 hover:bg-blue-600">Согласовано руководителем</Badge><span>этап руководителя пройден;</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-emerald-600 hover:bg-emerald-600">Согласовано</Badge><span>заявка полностью утверждена;</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="destructive">Отклонено</Badge><span>проверьте комментарий руководителя и создайте исправленную заявку при необходимости.</span>
            </div>
            <p className="border-t pt-3">Руководители используют раздел «Согласование». Им доступны сведения о маршруте, датах, цели и бронировании Trivio. Координатор может просматривать поездки, но не согласовывает их.</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="calendar">
          <AccordionTrigger className="text-left text-base">Календарь</AccordionTrigger>
          <AccordionContent className="space-y-2 text-sm leading-6 text-muted-foreground">
            <p>Переключайте месячный, недельный и квартальный вид, используйте стрелки для выбора периода.</p>
            <p>Нажмите на день, чтобы посмотреть запланированные поездки. Цветные метки внутри дня показывают статус командировки.</p>
            <p>Субботы, воскресенья и праздники выделены мягким розовым цветом. Доступные сотрудники и поездки зависят от вашей роли и организационной структуры.</p>
          </AccordionContent>
        </AccordionItem>

        {canViewRegistryGuide && (
          <AccordionItem value="registry">
            <AccordionTrigger className="text-left text-base">Реестр командировок</AccordionTrigger>
            <AccordionContent className="space-y-2 text-sm leading-6 text-muted-foreground">
              <p>Вкладка «Реестр» в разделе «Администратор» доступна администратору и координатору.</p>
              <p>Укажите начало и окончание любого периода. В реестр попадут согласованные командировки, которые пересекаются с выбранными датами.</p>
              <p>Кнопка «Скачать Excel» сформирует файл с тем же периодом в названии и заголовке.</p>
            </AccordionContent>
          </AccordionItem>
        )}

        {canViewAnalyticsGuide && (
          <AccordionItem value="analytics">
            <AccordionTrigger className="text-left text-base">Аналитика</AccordionTrigger>
            <AccordionContent className="space-y-2 text-sm leading-6 text-muted-foreground">
              <p>Раздел «Аналитика» доступен администратору, координатору, генеральному директору и заместителям генерального директора.</p>
              <p>Выберите произвольный период, чтобы увидеть динамику командировок, статусы, виды транспорта, рейтинги отделов и сотрудников, маршруты, нагрузку согласующих и обезличенную активность чата.</p>
              <p>Показатель «Расчётные суточные» считается по действующему нормативу и числу ночей. Фактические расходы на билеты и проживание не включаются, поскольку они пока не вносятся в приложение.</p>
            </AccordionContent>
          </AccordionItem>
        )}

        <AccordionItem value="chat">
          <AccordionTrigger className="text-left text-base">Чат и уведомления</AccordionTrigger>
          <AccordionContent className="space-y-4 text-sm leading-6 text-muted-foreground">
            <div className="flex gap-2">
              <MessageCircle className="mt-1 h-4 w-4 shrink-0 text-primary" />
              <p>В чате первыми контактами указаны Администратор и Координатор, далее доступны коллеги отдела и непосредственный руководитель. Координатор может выбрать любого пользователя системы.</p>
            </div>
            <div className="flex gap-2">
              <UserRound className="mt-1 h-4 w-4 shrink-0 text-primary" />
              <p>Красная цифра возле «Чат» показывает общее число непрочитанных сообщений. При новом сообщении появится всплывающее окно с именем отправителя, а его ФИО в списке контактов станет красным.</p>
            </div>
            <p>На настроенный рабочий e-mail приходит уведомление о новом сообщении без текста переписки. Откройте письмо и перейдите в чат по кнопке.</p>
            <p>По ошибкам приложения, доступам и исправлению данных используйте раздел «Связь с администратором» в «Моём профиле».</p>
            <a
              href={trivioUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 font-medium text-primary hover:underline"
            >
              Открыть Trivio
              <ExternalLink className="h-4 w-4" />
            </a>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="help">
          <AccordionTrigger className="text-left text-base">Что проверить при проблеме</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-2 text-sm leading-6 text-muted-foreground">
              {[
                "Не удается войти или пароль забыт: нажмите «Забыли пароль?» на странице входа и отправьте запрос администратору.",
                "Нет руководителя или коллег в чате: проверьте отдел и руководителя в профиле.",
                "Нет уведомления о сообщении: обновите страницу, затем проверьте папку «Спам» рабочей почты.",
                "Нет нужного маршрута: передайте администратору последовательность городов для добавления в справочник.",
                "Изменения не видны: обновите страницу, при необходимости используйте Ctrl+F5.",
              ].map((item) => (
                <div key={item} className="flex gap-2">
                  <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-600" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
