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
            <p>Координатор видит все поездки в дашборде и календаре, работает со справочниками и проверяет заявки перед заместителем ГД. Генеральный директор подтверждает плановые поездки после подписи реестра. Координатор не меняет суточные или параметры рассылки.</p>
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
              "Выберите тип: «Плановая» или «Внеплановая». Плановую поездку можно отправить до 25-го числа текущего месяца, если ее начало приходится на следующий месяц. После 25-го числа, а также после утверждения плана Генеральным директором, новые поездки на этот месяц оформляются только как внеплановые.",
              "Для внеплановой поездки укажите обоснование; при переносе выберите исходную командировку и причину переноса.",
              "Выберите «Сохранить черновик» либо «Отправить на согласование».",
            ]} />
            <div className="flex flex-wrap items-center gap-2 border-t pt-4 text-sm text-muted-foreground">
              <Plane className="h-4 w-4 text-primary" />
              <span>Субботы, воскресенья и праздники выделены розовым. Поездку на такую дату нужно подтвердить.</span>
            </div>
            <div className="space-y-2 border-t pt-4 text-sm leading-6 text-muted-foreground">
              <p className="font-medium text-foreground">Расчет суточных</p>
              <p>Предварительная сумма отображается после выбора дат и вида транспорта. Размер суточных устанавливает администратор; сейчас он составляет 1 700 руб. за сутки.</p>
              <p>Суточные начисляются за каждый календарный день командировки, включая даты начала и окончания. Например, поездка с 01.09 по 04.09 составляет 4 суток: 4 x 1 700 = 6 800 руб.</p>
              <p>Для однодневной поездки на автомобиле суточные не начисляются. При поездке авиа- или железнодорожным транспортом начисляется одна суточная ставка. Для поездки длительностью два дня и более суточные начисляются за все дни независимо от вида транспорта.</p>
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
              <Badge className="bg-blue-600 hover:bg-blue-600">Ожидает руководителя</Badge><span>заявка проходит последовательные этапы руководителей по организационной структуре;</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-violet-600 hover:bg-violet-600">Проверка координатора</Badge><span>координатор проверяет маршрут, даты, обоснование и данные бронирования;</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-indigo-600 hover:bg-indigo-600">Ожидает ЗГД</Badge><span>заявка передана заместителю генерального директора на решение;</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-sky-700 hover:bg-sky-700">Ожидает ГД</Badge><span>внеплановая заявка передана генеральному директору на финальное решение;</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-cyan-700 hover:bg-cyan-700">В реестре на подпись ГД</Badge><span>плановая заявка включена в реестр и ожидает подписи генерального директора;</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-emerald-600 hover:bg-emerald-600">Плановая (утверждена ГД)</Badge><span>после подписи реестра генеральный директор подтвердил плановую поездку в системе;</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-green-500 hover:bg-green-500">Согласовано</Badge><span>внеплановая заявка полностью утверждена;</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="destructive">Отклонено</Badge><span>проверьте комментарий руководителя и создайте исправленную заявку при необходимости.</span>
            </div>
            <p className="border-t pt-3">Руководители используют раздел «Согласование» по своей очереди. Все поездки проходят: пользователь → руководитель (и вышестоящие руководители при наличии) → координатор → ЗГД → ГД. Плановая поездка после ЗГД включается в реестр на подпись, затем подтверждается ГД в приложении. Внеплановая поездка поступает ГД на финальное решение сразу после ЗГД.</p>
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
              <p>Укажите начало и окончание любого периода. В реестр попадут согласованные внеплановые, утвержденные плановые и плановые поездки со статусом «В реестре на подпись ГД», которые пересекаются с выбранными датами.</p>
              <p>После бумажной подписи реестра генеральный директор открывает «Согласование» и нажимает «Утвердить все плановые». Заявки получают статус «Плановая (утверждена ГД)», а администратор и координатор получают сообщение в чате.</p>
              <p>Новый реестр можно сформировать и выгрузить только после подтверждения генеральным директором всех плановых поездок выбранного периода. Утвержденные периоды можно открывать и выгружать повторно без ограничений.</p>
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
              <p>Показатель «Расчётные суточные» считается по действующему нормативу и числу календарных дней командировки. Фактические расходы на билеты и проживание не включаются, поскольку они пока не вносятся в приложение.</p>
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
